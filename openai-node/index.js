import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import bodyParser from "body-parser";
import archiver from "archiver";

const app = express();
app.use(bodyParser.json());

// ---------- CORS CONFIG ----------
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:8080",
  "https://your-ui-domain.com"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith("http://localhost")) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    }
  })
);

import dotenv from "dotenv";
dotenv.config();

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---------- UTILITY: Save files as they are ----------
function saveGeneratedFiles(projectName, filesObj) {
  const folder = path.join("generated_projects", projectName);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

  for (const fileName of Object.keys(filesObj)) {
    const filePath = path.join(folder, fileName);
    const content = filesObj[fileName];

    // Ensure folder path exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
  }
}

// ---------- UTILITY: Create ZIP file ----------
function createZipFile(projectName, filesObj) {
  return new Promise((resolve, reject) => {
    const zipPath = path.join("generated_projects", `${projectName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`ZIP created: ${zipPath} (${archive.pointer()} bytes)`);
      resolve(zipPath);
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add files to zip
    for (const fileName of Object.keys(filesObj)) {
      const content = filesObj[fileName];
      archive.append(content, { name: fileName });
    }

    archive.finalize();
  });
}

// ---------- UTILITY: Validate generated files ----------
function validateGeneratedFiles(filesObj) {
  const errors = [];
  const fileNames = Object.keys(filesObj);

  // Check if package.json exists
  const hasPackageJson = fileNames.some(f => f.endsWith('package.json'));
  
  if (!hasPackageJson) {
    errors.push("package.json is missing - REQUIRED for all projects");
    return errors; // Can't validate further without package.json
  }

  try {
    const packageJson = JSON.parse(filesObj[fileNames.find(f => f.endsWith('package.json'))]);
    
    // Check for required fields
    if (!packageJson.name) errors.push("package.json missing 'name' field");
    if (!packageJson.version) errors.push("package.json missing 'version' field");
    if (!packageJson.dependencies) errors.push("package.json missing 'dependencies' object");
    if (!packageJson.devDependencies) errors.push("package.json missing 'devDependencies' object");
    
    const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

    // Scan all files for imports and verify they're in dependencies
    const importRegex = /(?:import|require)\s+(?:{[^}]*}|[^;]*?)\s+from\s+['"]([^'"]+)['"]/g;
    const missingDeps = new Set();
    
    for (const fileName of fileNames) {
      const content = filesObj[fileName];
      let match;
      
      while ((match = importRegex.exec(content)) !== null) {
        const moduleName = match[1];
        
        // Skip relative imports
        if (moduleName.startsWith('.') || moduleName.startsWith('/')) continue;
        
        // Get the package name (handle scoped packages like @vitejs/plugin-react)
        const packageName = moduleName.startsWith('@') 
          ? moduleName.split('/').slice(0, 2).join('/')
          : moduleName.split('/')[0];
        
        if (!allDeps[packageName]) {
          missingDeps.add(`"${packageName}": "^1.0.0"`);
        }
      }
    }
    
    if (missingDeps.size > 0) {
      errors.push(`Missing dependencies in package.json: ${Array.from(missingDeps).join(', ')}`);
    }

    // If vite.config.js exists, check for required dependencies
    const hasViteConfig = fileNames.some(f => f.endsWith('vite.config.js'));
    if (hasViteConfig) {
      const viteContent = filesObj[fileNames.find(f => f.endsWith('vite.config.js'))];
      
      if (viteContent.includes('@vitejs/plugin-react') && !allDeps['@vitejs/plugin-react']) {
        errors.push("vite.config.js uses '@vitejs/plugin-react' → add to devDependencies: \"@vitejs/plugin-react\": \"^4.0.0\"");
      }
      if (viteContent.includes('@vitejs/plugin-vue') && !allDeps['@vitejs/plugin-vue']) {
        errors.push("vite.config.js uses '@vitejs/plugin-vue' → add to devDependencies: \"@vitejs/plugin-vue\": \"^4.0.0\"");
      }
      
      // Check for index.html
      const hasIndexHtml = fileNames.includes('index.html');
      if (!hasIndexHtml) {
        errors.push("index.html is missing - REQUIRED for Vite projects (must be in root directory)");
      }
      
      // Check for entry point
      const hasMainJs = fileNames.some(f => f.includes('src/main.js') || f.includes('src/main.jsx'));
      if (!hasMainJs) {
        errors.push("src/main.js or src/main.jsx is missing - REQUIRED for Vite entry point");
      }
    }

    // Check for React
    const hasReact = fileNames.some(f => filesObj[f].includes('import React') || filesObj[f].includes('from "react"'));
    if (hasReact && !allDeps['react']) {
      errors.push("React code found but 'react' not in dependencies → add: \"react\": \"^18.2.0\"");
    }
    
    if (hasReact && !allDeps['react-dom']) {
      errors.push("React code found but 'react-dom' not in dependencies → add: \"react-dom\": \"^18.2.0\"");
    }

  } catch (err) {
    errors.push(`Invalid package.json format: ${err.message}`);
  }

  return errors;
}

// ---------- MAIN ENDPOINT ----------
app.post("/generate", async (req, res) => {
  try {
    const { query, componentLibrary, projectName, cms } = req.body;

    // Debug logging to see what values are received
    console.log("Received payload:", { query: query?.substring(0, 50) + "...", componentLibrary, projectName, cms });

    if (!query) {
      return res.status(400).json({ error: "Query text is required." });
    }

    // --------------------- DYNAMIC SMART PROMPT ------------------------
    // Includes:
    // - Complete project → tooling files required
    // - UI component library (optional)
    // - CMS-specific code generation
    // - File names maintain as AI sends
    const prompt = `
You are a code generator AI. Follow EXACT rules:

RULES:
1. When user asks for "complete project", ALWAYS include these files with COMPLETE content:
   - package.json (with ALL required dependencies, latest COMPATIBLE versions - minimum Node 14+)
   - vite.config.js or webpack.config.js (complete, working configuration)
   - tsconfig.json (if TypeScript is used - complete configuration)
   - .gitignore (with language-specific entries)
   - .npmrc or similar config files
   - Build + tooling config files (eslint.config.js, prettier.config.js, etc.)
   - README.md (detailed setup and usage instructions)
   - Any other necessary dev/config files
   - DO NOT OMIT ANY DEPENDENCIES - include everything needed to run 'npm install' successfully

2. Keep filenames EXACTLY as you output them. Do not rename or modify.

3. For package.json REQUIREMENTS:
   - List ALL dependencies (not just some)
   - Use current, compatible versions (published within last 2 years)
   - Include both devDependencies and dependencies
   - Include npm scripts for build, dev, test, etc.
   - Specify Node version requirement (engines field)
   - Set correct license and author

4. For configuration files:
   - Provide COMPLETE, production-ready configurations
   - No placeholder comments like "// add more config here"
   - Every required setting must be present and functional
   - Include comments explaining critical settings

5. Generate CMS-specific code based on the target platform:
   - AEM: Generate HTL templates, Sling Models, XML config, clientlibs folder structure, .content.xml files
   - Sitecore: Generate CSHTML views, rendering files, YAML configs, serialized items  
   - Drupal: Generate Twig templates, PHP modules, YAML configs, theme files
   - Generic: Standard HTML/CSS/JS if no specific CMS is selected

6. Output ONLY a JSON object with this format:

{
  "files": {
    "fileName.ext": "file content here",
    "folder/anotherfile.js": "content here"
  }
}

7. CRITICAL REQUIREMENTS for completeness:
   - EVERY file must be complete with NO shortcuts or abbreviations
   - NO placeholder code like "// ... rest of the code" or "// add more here"
   - All dependencies MUST be listed in package.json with exact versions
   - All imports/requires must be satisfied by listed dependencies
   - Configuration files must include all required settings
   - No external dependencies should be assumed - they must be in package.json
   - If using component libraries, ALL required dependencies MUST be included
   - VERIFY: Every module imported in config files (vite.config.js, webpack.config.js, etc.) MUST exist in package.json
   - VERIFY: If using Vite, ALWAYS include index.html as entry point
   - VERIFY: Every import statement must have corresponding package.json dependency

8. IMPORTANT: File content must be raw code only. No backticks, no markdown code blocks.

9. DEPENDENCY VERIFICATION CHECKLIST - DO THIS BEFORE RETURNING JSON:
   - SCAN every .js/.ts file for: import/require statements
   - SCAN every config file (vite.config.js, webpack.config.js, etc.) for imports
   - FOR EACH import found:
     * Verify it exists in package.json dependencies OR devDependencies
     * If missing, ADD IT NOW with appropriate version
   - If config file imports '@vitejs/plugin-react' → MUST have "@vitejs/plugin-react": "^4.0.0" in devDependencies
   - If config file imports '@vitejs/plugin-vue' → MUST have "@vitejs/plugin-vue": "^4.0.0" in devDependencies  
   - If code uses 'import React' → MUST have "react" in dependencies
   - If code uses JSX → MUST have both "react" and "react-dom" in dependencies
   - If using Vite → MUST include "index.html" file in root
   - If using Vite → MUST include "src/main.js" or "src/main.jsx" file

10. PRE-SUBMISSION VALIDATION (BEFORE generating JSON):
   - Create mental checklist of all files needed
   - Check package.json has: name, version, dependencies, devDependencies, scripts, engines
   - Scan ALL files for imports, verify each is in package.json
   - Verify index.html exists if using Vite
   - Verify entry points exist (src/main.js, src/main.jsx, etc.)
   - IF ANY import is missing from package.json, ADD IT NOW
   - Count files: should be reasonable number (10-30 files typical for complete project)

CONFIGURATION:
- Component Library: ${componentLibrary || "Vanilla CSS/JS (no specific library)"}
- Target CMS Platform: ${cms || "Generic Web Development"}

INSTRUCTIONS:
${componentLibrary ? `- Use ${componentLibrary} components and styling throughout the code` : '- Use standard HTML/CSS/JS components'}
${cms ? `- Generate code specifically for ${cms} platform with proper file structure and conventions` : '- Generate standard web development files'}
${cms === 'AEM' ? `- Generate a complete CRXDE-ready AEM package structure:
   - Create folder: jcr_root/apps/your-app-name/components/ with proper .content.xml files
   - Each component must have:
     * component.html (HTL template)
     * .content.xml (jcr:root with proper namespaces: xmlns:sling, xmlns:cq, xmlns:jcr)
     * _cq_dialog.xml (dialog configuration)
     * _cq_editConfig.xml (edit configuration)
   - Create jcr_root/apps/your-app-name/clientlibs/clientlib-base/ with:
     * .content.xml (jcr:root node with sling:resourceType="cq/clientlib/components/clientlib")
     * js.txt (listing JS files)
     * css.txt (listing CSS files)
     * js/ folder with sample JS files
     * css/ folder with sample SCSS/CSS files
   - Create .vltignore file
   - Create filter.xml at root (defines what's deployed)
   - Create META-INF/vault/properties.xml (package metadata)
   - Create a comprehensive README.md with step-by-step instructions including:
     * Prerequisites (AEM version, permissions needed)
     * How to import package into CRXDE Lite
     * How to build and deploy the package
     * Component structure explanation
     * How to modify and extend components
     * Testing instructions
   - All file paths must follow AEM conventions: jcr_root/path/to/component/
   - All .content.xml files must include proper JCR namespaces and sling:resourceType` : ''}
${cms === 'Sitecore' ? `- Generate a complete Sitecore-ready project structure:
   - Create folder structure: src/Project.Web/Views/Renderings/ for view files
   - Create src/Project.Models/ with C# model classes for data binding
   - Create src/Project.Feature/ with feature-specific rendering files (CSHTML)
   - Each rendering must have:
     * CSHTML view file with proper Sitecore placeholders
     * Associated C# model/controller if needed
     * Web.config transformations for deployment
   - Create App_Config/Include/ folder with Sitecore configuration patches (.config files)
   - Create serialization folder structure: ~/serialization/Project/Renderings/ with YAML files
   - Create unicorn.config file for serialization configuration
   - Create gulpfile.js or webpack.config.js for asset building
   - Create package.json with necessary dependencies
   - Include .gitignore with Sitecore-specific entries
   - Create comprehensive README.md with:
     * Sitecore version requirements
     * Installation prerequisites (Visual Studio, NuGet packages)
     * Step-by-step deployment instructions
     * How to create and configure renderings in Sitecore
     * How to serialize items
     * Build and deployment process
     * Local development setup
   - All CSHTML files must include @model directives
   - All configuration files must follow Sitecore conventions` : ''}
${cms === 'Drupal' ? `- Generate a complete Drupal-ready module/theme structure:
   - Create modules/ folder with custom module(s):
     * custom_module.info.yml (module metadata)
     * custom_module.module (module hooks)
     * src/Plugin/Block/ folder with block plugins
     * src/Form/ folder with form definitions
     * src/Controller/ folder with controllers
     * templates/ folder with Twig templates
     * css/ and js/ folders with assets
   - Create themes/ folder with custom theme:
     * theme.info.yml (theme metadata)
     * theme.libraries.yml (library definitions)
     * templates/ folder with Twig template files
     * css/main.css and js/main.js
     * config/schema/ for configuration schema
     * config/install/ for default configuration
   - Create composer.json with dependencies
   - Create package.json with npm dependencies
   - Create .gitignore with Drupal-specific entries
   - Create webpack.config.js or gulp for asset compilation
   - Create comprehensive README.md with:
     * Drupal version requirements (8/9/10)
     * Installation prerequisites (Composer, Node.js)
     * Step-by-step installation instructions
     * How to enable the module/theme
     * How to create custom blocks
     * How to modify Twig templates
     * Asset compilation process
     * Development and debugging tips
     * Database migration instructions if applicable
   - All YAML files must follow Drupal conventions
   - All Twig templates must include proper variable documentation` : ''}

USER QUERY:
${query}
    `;

    // --------- SEND TO OPENAI ---------
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    });

    let aiText = response.choices[0].message.content.trim();

    // --------- PARSE JSON SAFELY ---------
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(aiText);
    } catch (err) {
      return res.status(500).json({
        error: "AI returned invalid JSON.",
        raw: aiText
      });
    }

    // --------- VALIDATE GENERATED FILES ---------
    if (jsonResponse.files) {
      const validationErrors = validateGeneratedFiles(jsonResponse.files);
      if (validationErrors.length > 0) {
        return res.status(400).json({
          error: "Generated project has validation errors",
          issues: validationErrors,
          suggestion: "Please regenerate with a more specific query"
        });
      }
    }

    // --------- SAVE FILES AND CREATE ZIP ---------
    if (jsonResponse.files) {
      const cmsPrefix = cms ? `${cms.toLowerCase()}_` : '';
      const folderName = `${cmsPrefix}${projectName}_${Date.now()}` || `project_${Date.now()}`;
      
      console.log("Creating project with name:", folderName);
      
      // Save files to folder
      saveGeneratedFiles(folderName, jsonResponse.files);
      
      // Create zip file
      const zipPath = await createZipFile(folderName, jsonResponse.files);
      const zipFileName = path.basename(zipPath);
      
      console.log("Sending response with actualProjectName:", folderName);
      
      return res.status(200).json({
        success: true,
        files: jsonResponse.files,
        message: "Project generated successfully.",
        zipFileName: zipFileName,
        downloadUrl: `/download/${zipFileName}`,
        actualProjectName: folderName  // Return the actual folder name created
      });
    }

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- DOWNLOAD ENDPOINT ----------
app.get("/download/:filename", (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join("generated_projects", filename);
    
    // Security check - ensure file exists and is in the correct directory
    if (!fs.existsSync(filePath) || !filename.endsWith('.zip')) {
      return res.status(404).json({ error: "File not found" });
    }
    
    // Set headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Optional: Delete the zip file after a delay (cleanup)
    setTimeout(() => {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Cleaned up: ${filename}`);
      }
    }, 300000); // Delete after 5 minutes
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- START SERVER ----------
app.listen(4000, () => console.log("Server running on port 4000"));