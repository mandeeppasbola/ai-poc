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
1. When user asks for "complete project", always include:
   - package.json
   - vite.config.js or webpack.config.js
   - tsconfig.json (if TypeScript is implied)
   - folder structure suggestions
   - .gitignore
   - Build + tooling config files
   - Any other necessary dev files

2. Keep filenames EXACTLY as you output them. Do not rename or modify.

3. Generate CMS-specific code based on the target platform:
   - AEM: Generate HTL templates, Sling Models, XML config, clientlibs folder structure, .content.xml files
   - Sitecore: Generate CSHTML views, rendering files, YAML configs, serialized items  
   - Drupal: Generate Twig templates, PHP modules, YAML configs, theme files
   - Generic: Standard HTML/CSS/JS if no specific CMS is selected

4. Output ONLY a JSON object with this format:

{
  "files": {
    "fileName.ext": "file content here",
    "folder/anotherfile.js": "content here"
  }
}

5. IMPORTANT: File content must be raw code only. No backticks.

CONFIGURATION:
- Component Library: ${componentLibrary || "Vanilla CSS/JS (no specific library)"}
- Target CMS Platform: ${cms || "Generic Web Development"}

INSTRUCTIONS:
${componentLibrary ? `- Use ${componentLibrary} components and styling throughout the code` : '- Use standard HTML/CSS/JS components'}
${cms ? `- Generate code specifically for ${cms} platform with proper file structure and conventions` : '- Generate standard web development files'}
${cms === 'AEM' ? '- Include HTL templates, Sling Models, and AEM-specific configurations' : ''}
${cms === 'Sitecore' ? '- Include CSHTML views, Sitecore rendering files, and YAML configurations' : ''}
${cms === 'Drupal' ? '- Include Twig templates, PHP modules, and Drupal-specific theme files' : ''}

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
