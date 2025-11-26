import React, { useState } from 'react';
// Using Lucide icons for a clean look
import { Send, Loader2, MessageSquare, Server, AlertTriangle } from 'lucide-react';
 
// --- Utility Functions for API Communication ---
 
/**
* Implements exponential backoff for retrying API calls, primarily useful for external APIs,
* but retained here for robust networking structure.
*/
const exponentialBackoffFetch = async (url, options, retries = 5) => {
    let lastError = null;
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                // Return response to handle custom server errors in the main logic
                return response;
            }
            return response;
        } catch (error) {
            lastError = error;
            const delay = Math.pow(2, i) * 1000; // 1s, 2s, 4s, 8s, 16s
            if (i < retries - 1) {
                console.log(`Retrying API call in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
    // Re-throw the error if all retries fail, maintaining the network failure message
    throw new Error(`API call failed after ${retries} attempts: ${lastError?.message || "Check network connection or CORS settings"}.`);
};
 
 
// --- Main React Component ---
 
const API_ENDPOINT = 'http://localhost:3000/ask';
const MIN_PROMPT_LENGTH = 5;
 
const App = () => {
    
    const [prompt, setPrompt] = useState('Hi, what are the core benefits of using React hooks?');
    const [chatResponse, setChatResponse] = useState(null); // Stores the simple string response
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
 
    const handleGenerate = async () => {
        const trimmedPrompt = prompt.trim();
        
        // 1. Clear previous errors and response
        setError(null);
        setChatResponse(null);
 
        // 2. Input Validation
        if (!trimmedPrompt) {
            setError('Query cannot be empty. Please enter some text.');
            return;
        }
 
        if (trimmedPrompt.length < MIN_PROMPT_LENGTH) {
            setError(`Query is too short. Please enter at least ${MIN_PROMPT_LENGTH} characters.`);
            return;
        }
 
        // Validation passed, proceed with API call preparation
        setIsLoading(true);
        
        const payload = {
            query: trimmedPrompt
        };
 
        try {
            // Making the actual network call to the specified endpoint
            const response = await exponentialBackoffFetch(API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
 
            // If the response is not JSON, it could be a CORS issue or an empty response body
            const result = await response.json().catch(() => {
                throw new Error("Received non-JSON or empty response from the server.");
            });
 
            if (result.success === true) {
                // Handle successful response structure
                setChatResponse(result.response);
            } else if (result.success === false) {
                // Handle failure response structure
                const message = result.message || "An unknown error occurred on the server.";
                const details = result.details?.error?.message || "No specific details provided.";
                setError(`Server Error: ${message} (Details: ${details})`);
            } else {
                // Handle unexpected successful response structure
                setError("Received an unexpected response format from the server. Check your API payload.");
                console.error("Unexpected Server Response:", result);
            }
 
        } catch (err) {
            console.error('Network Error:', err);
            // Catch network level errors (e.g., server down, CORS issues, or the expected localhost blockage)
            setError(`Network or Server Error: ${err.message}. Please ensure your Node.js API server is running locally on port 3000 and check CORS policies.`);
        } finally {
            setIsLoading(false);
        }
    };
 
    const renderResponse = () => {
        if (!chatResponse) {
            return (
                <div className="text-center p-8 text-gray-500 bg-gray-50 rounded-lg flex flex-col items-center">
                    <MessageSquare className="w-8 h-8 mb-3 text-gray-400" />
                    <p className="font-medium">Waiting for response...</p>
                    <p className="text-sm">Enter your query and hit 'Send' to connect to your local API.</p>
                </div>
            );
        }
 
        return (
            <div className="bg-white p-6 rounded-lg shadow-inner border border-gray-200">
                <h3 className="text-lg font-bold text-indigo-700 mb-3 flex items-center">
                    <Server className="w-5 h-5 mr-2" />
                    API Response
                </h3>
                <div className="whitespace-pre-wrap text-gray-700 max-h-96 overflow-y-auto p-3 bg-indigo-50 rounded-md border border-indigo-100">
                    {chatResponse}
                </div>
            </div>
        );
    };
 
    return (
        <div className="min-h-screen p-4 md:p-8 bg-gray-50 font-sans">
            <header className="mb-8">
                <h1 className="text-3xl font-extrabold text-indigo-800 flex items-center">
                    <Server className="w-8 h-8 mr-3 text-indigo-600" />
                    Local Chat API Client
                </h1>
                <p className="text-gray-600 mt-1">
                    Attempting to connect to: <code className="font-mono bg-gray-200 p-1 rounded">http://localhost:3000/ask</code>.
                </p>
                
                {/* Warning about localhost access */}
                <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-3 mt-4 rounded-lg shadow-sm flex items-start text-sm" role="alert">
                    <AlertTriangle className="w-5 h-5 mr-3 mt-0.5 flex-shrink-0" />
                    <p>
                        **Warning:** This application is running in a cloud sandbox and cannot connect to a server running on your local machine's `localhost`. The `fetch` call is live, but will likely result in a network error here.
                    </p>
                </div>
            </header>
 
            <div className="bg-white p-6 rounded-xl shadow-2xl border border-indigo-200/50 mb-8">
                <div className="flex flex-col md:flex-row gap-4">
                    <textarea
                        className="flex-grow min-h-[120px] p-4 text-sm border-2 border-gray-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 resize-none"
                        placeholder={`Type your question or message here (min ${MIN_PROMPT_LENGTH} characters)...`}
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        disabled={isLoading}
                    />
                    <button
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="w-full md:w-48 flex items-center justify-center px-6 py-3 text-white font-semibold rounded-lg shadow-lg
                                   bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 transition duration-150 ease-in-out disabled:bg-indigo-400"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                Sending...
                            </>
                        ) : (
                            <>
                                <Send className="w-5 h-5 mr-2" />
                                Send Query
                            </>
                        )}
                    </button>
                </div>
            </div>
            
            {/* Error Message Display (for validation OR API errors) */}
            {error && (
                <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-lg shadow-md" role="alert">
                    <p className="font-bold">Error Occurred</p>
                    <p className="text-sm">{error}</p>
                </div>
            )}
 
            {/* Results Display */}
            <div className="mt-8">
                <h2 className="text-xl font-bold text-gray-700 mb-4">
                    Conversation Output
                </h2>
                {renderResponse()}
            </div>
        </div>
    );
};
 
export default App;