import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx'; // ⬅️ FIX: Added .jsx extension for explicit file resolution
import './index.css'; // ⬅️ Import Tailwind CSS and global styles
 
// Get the root element from index.html
const rootElement = document.getElementById('root');
 
if (rootElement) {
    // Create the root container and render the App component inside it
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
} else {
    console.error("Failed to find the root element in index.html (expected ID 'root').");
}