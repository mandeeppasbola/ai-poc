import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import bodyParser from "body-parser";

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

// ---------- MAIN ENDPOINT ----------
app.post("/generate", async (req, res) => {
  try {
    const { query, componentLibrary, projectName } = req.body;

    if (!query) {
      return res.status(400).json({ error: "Query text is required." });
    }

    // --------------------- DYNAMIC SMART PROMPT ------------------------
    // Includes:
    // - Complete project → tooling files required
    // - UI component library (optional)
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

3. You may generate code for:
   - AEM (HTL, Sling Models, XML config, clientlibs folder)
   - Sitecore (CSHTML, rendering files, YAML, serialized items)
   - React (jsx, tsx, components, hooks)
   - HTML, CSS, JS, SCSS
   - Any config files
   - Any additional files you think the project requires

4. Output ONLY a JSON object with this format:

{
  "files": {
    "fileName.ext": "file content here",
    "folder/anotherfile.js": "content here"
  }
}

5. IMPORTANT: File content must be raw code only. No backticks.

6. If a UI component library is mentioned by the user, ALWAYS incorporate it.
   The user's component library is: ${componentLibrary || "none provided"}

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

    // --------- SAVE FILES IF ANY ---------
    if (jsonResponse.files) {
      const folderName = `${projectName}${Date.now()}` || `project_${Date.now()}`;
      saveGeneratedFiles(folderName, jsonResponse.files);
    }

    return res.status(200).json({
      success: true,
      files: jsonResponse.files,
      message: "Project generated successfully."
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- START SERVER ----------
app.listen(4000, () => console.log("Server running on port 4000"));
