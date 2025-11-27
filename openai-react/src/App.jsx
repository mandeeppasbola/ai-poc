import React, { useState, useEffect, useRef } from 'react';
// Using Lucide icons for a clean look
import { Send, Loader2, MessageSquare, AlertTriangle, CheckCircle, Sparkles, Brain, Zap, Download } from 'lucide-react';
 
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
 
const API_ENDPOINT = 'http://localhost:4000/generate';
const MIN_PROMPT_LENGTH = 10;
const MAX_PROMPT_LENGTH = 1000;

const App = () => {
    
    const [prompt, setPrompt] = useState('');
    const [chatResponse, setChatResponse] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showNextSteps, setShowNextSteps] = useState(false);
    const [isPageLoaded, setIsPageLoaded] = useState(false);
    const [dropdown1Value, setDropdown1Value] = useState('');
    const [dropdown2Value, setDropdown2Value] = useState('');
    const [projectName, setProjectName] = useState('');
    const [downloadUrl, setDownloadUrl] = useState(null);
    const [zipFileName, setZipFileName] = useState(null);
    const [generatedResult, setGeneratedResult] = useState(null);
    const responseRef = useRef(null);

    // Dropdown 1 options - UI component library
    const dropdown1Options = [
        { value: '', label: 'Select Component library' },
        { value: 'Flowbite', label: 'Flowbite library'},
        { value: 'Material UI', label: 'Material UI library'},
        { value: 'Chakra UI', label: 'Chakra UI library'},
    ];

    // Dropdown 2 options - CMS
    const dropdown2Options = [
        { value: '', label: 'Select CMS' },
        { value: 'AEM', label: 'AEM'},
        { value: 'Drupal', label: 'Drupal' },
        { value: 'SiteCore', label: 'SiteCore' },
    ];    // Trigger drop-in animation on page load
    useEffect(() => {
        const timer = setTimeout(() => {
            setIsPageLoaded(true);
        }, 100); // Small delay for smooth animation
        
        return () => clearTimeout(timer);
    }, []);

    // Next step suggestions based on the response
   /*  const nextStepSuggestions = [
        "Ask for more detailed examples",
        "Request implementation code",
        "Ask about best practices",
        "Compare with alternatives",
        "Ask about common pitfalls",
        "Request related concepts",
        "Ask for real-world use cases",
        "Get troubleshooting tips"
    ]; */

    const handleNextStepClick = (nextStep) => {
        const followUpPrompt = `${nextStep} related to: "${prompt}"`;
        setPrompt(followUpPrompt);
        setShowNextSteps(false);
        // Automatically trigger the API call with the new prompt
        handleGenerateWithPrompt(followUpPrompt);
    };

    const handleGenerateWithPrompt = async (customPrompt = null) => {
        const currentPrompt = customPrompt || prompt;
        
        // 1. Clear previous errors and response
        setError(null);
        setChatResponse(null);
        setShowNextSteps(false);
        setDownloadUrl(null);
        setZipFileName(null);
        setGeneratedResult(null);

        // 2. Validate only when sending (not real-time)
        const trimmedPrompt = currentPrompt.trim();
        
        if (!trimmedPrompt) {
            setError('Please enter your question or request');
            return;
        }

        if (trimmedPrompt.length < MIN_PROMPT_LENGTH) {
            setError(`Your prompt must be at least ${MIN_PROMPT_LENGTH} characters`);
            return;
        }

        if (trimmedPrompt.length > MAX_PROMPT_LENGTH) {
            setError(`Your prompt must be less than ${MAX_PROMPT_LENGTH} characters`);
            return;
        }

        if (!dropdown1Value && !customPrompt) {
            setError('Please select a technology category');
            return;
        }

        if (!dropdown2Value && !customPrompt) {
            setError('Please select your CMS');
            return;
        }

        // Validation passed, proceed with API call preparation
        setIsLoading(true);
        
        const selectedTech = dropdown1Options.find(opt => opt.value === dropdown1Value);
        const selectedCMS = dropdown2Options.find(opt => opt.value === dropdown2Value);
        
        const payload = {
            query: `${trimmedPrompt} [Component Library: ${selectedTech?.label || 'None'}] [CMS Platform: ${selectedCMS?.label || 'Generic'}]`,
            componentLibrary: dropdown1Value || null,
            projectName: projectName || "ai-assistant-project",
            cms: dropdown2Value || null
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
                // Clear the form immediately after success but before setting response data
                setPrompt('');
                setDropdown1Value('');
                setDropdown2Value('');
                // DON'T clear projectName yet - we need it for fallback
                
                // Handle successful response structure
                setChatResponse(result.message || JSON.stringify(result.files, null, 2));
                // Set download info if available
                if (result.downloadUrl && result.zipFileName) {
                    setDownloadUrl(result.downloadUrl);
                    setZipFileName(result.zipFileName);
                }
                
                // Store the entire result for easy access to project name
                setGeneratedResult(result);
                
                // Now clear projectName after we've used it
                setProjectName('');
                
                // Show next steps dropdown after successful response
                setShowNextSteps(true);
                
                // Scroll to response section
                setTimeout(() => {
                    if (responseRef.current) {
                        responseRef.current.scrollIntoView({ 
                            behavior: 'smooth', 
                            block: 'start' 
                        });
                    }
                }, 100); // Small delay to ensure content is rendered
            } else if (result.error) {
                // Handle error response structure
                const message = result.error || "An unknown error occurred on the server.";
                setError(`Server Error: ${message}`);
                
                // Scroll to show the error message
                setTimeout(() => {
                    const errorElement = document.querySelector('[role="alert"]');
                    if (errorElement) {
                        errorElement.scrollIntoView({ 
                            behavior: 'smooth', 
                            block: 'center' 
                        });
                    }
                }, 100);
            } else {
                // Handle unexpected successful response structure
                setError("Received an unexpected response format from the server. Check your API payload.");
                console.error("Unexpected Server Response:", result);
                
                // Scroll to show the error message
                setTimeout(() => {
                    const errorElement = document.querySelector('[role="alert"]');
                    if (errorElement) {
                        errorElement.scrollIntoView({ 
                            behavior: 'smooth', 
                            block: 'center' 
                        });
                    }
                }, 100);
            }

        } catch (err) {
            console.error('Network Error:', err);
            // Catch network level errors (e.g., server down, CORS issues, or the expected localhost blockage)
            setError(`Network or Server Error: ${err.message}. Please ensure your Node.js API server is running locally on port 4000 and check CORS policies.`);
            
            // Scroll to show the error message
            setTimeout(() => {
                const errorElement = document.querySelector('[role="alert"]');
                if (errorElement) {
                    errorElement.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center' 
                    });
                }
            }, 100);
        } finally {
            setIsLoading(false);
        }
    };
 
    const handleGenerate = () => handleGenerateWithPrompt();

    const handleDownload = () => {
        if (downloadUrl) {
            const link = document.createElement('a');
            link.href = `http://localhost:4000${downloadUrl}`;
            link.download = zipFileName || 'project.zip';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    return (
        <div className={`min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 font-sans transition-all duration-1000 ease-out ${
            isPageLoaded 
                ? 'opacity-100 translate-y-0' 
                : 'opacity-0 -translate-y-8'
        }`}>
            {/* Modern Header */}
            <header className={`pt-8 pb-6 px-4 md:px-8 transition-all duration-1000 delay-200 ease-out ${
                isPageLoaded 
                    ? 'opacity-100 translate-y-0' 
                    : 'opacity-0 -translate-y-4'
            }`}>
                <div className="max-w-4xl mx-auto text-center">
                    <div className="flex items-center justify-center mb-4">
                        <div className="p-3 bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl shadow-lg">
                            <Brain className="w-8 h-8 text-white" />
                        </div>
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-800 bg-clip-text text-transparent mb-3">
                        AI Development Assistant
                    </h1>
                    <p className="text-lg text-gray-600 mb-2">
                        Get instant help with coding questions, tailored to your experience level
                    </p>
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                        <div className="flex items-center">
                            <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                            Connected to localhost:4000
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content Container */}
            <div className="max-w-4xl mx-auto px-4 md:px-8 pb-8">
                {/* Enhanced Input Form */}
                <div className={`bg-white rounded-3xl shadow-xl border border-gray-100 p-8 mb-8 transition-all duration-1000 delay-400 ease-out ${
                    isPageLoaded 
                        ? 'opacity-100 translate-y-0 scale-100' 
                        : 'opacity-0 translate-y-8 scale-95'
                }`}>
                    <div className="space-y-6">
                        {/* Prompt Input with Enhanced Design */}
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <label className="block text-lg font-semibold text-gray-800 flex items-center">
                                    <Sparkles className="w-5 h-5 mr-2 text-indigo-600" />
                                    Give your prompt for building an App
                                </label>
                            </div>
                            <textarea
                                className="w-full min-h-[140px] p-5 text-base border-2 border-gray-200 rounded-2xl transition-all duration-200 resize-none focus:outline-none focus:border-indigo-500 focus:bg-indigo-50/30"
                                placeholder="e.g., How do I create a responsive navigation bar in React? I want to include mobile hamburger menu and smooth animations..."
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                disabled={isLoading}
                            />
                        </div>

                        {/* Enhanced Dropdowns */}
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Technology Dropdown */}
                            <div className="space-y-3">
                                <label className="block text-base font-semibold text-gray-800 flex items-center">
                                    <Zap className="w-4 h-4 mr-2 text-indigo-600" />
                                    Technology Focus
                                </label>
                                <select
                                    value={dropdown1Value}
                                    onChange={(e) => setDropdown1Value(e.target.value)}
                                    className="w-full p-4 border-2 border-gray-200 rounded-2xl text-base transition-all duration-200 focus:outline-none focus:border-indigo-500 focus:bg-indigo-50/30"
                                    disabled={isLoading}
                                >
                                    {dropdown1Options.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                {dropdown1Value && (
                                    <p className="text-sm text-gray-600 italic">
                                        {dropdown1Options.find(opt => opt.value === dropdown1Value)?.description}
                                    </p>
                                )}
                            </div>

                            {/* Experience Level Dropdown */}
                            <div className="space-y-3">
                                <label className="block text-base font-semibold text-gray-800 flex items-center">
                                    <CheckCircle className="w-4 h-4 mr-2 text-indigo-600" />
                                    CMS
                                </label>
                                <select
                                    value={dropdown2Value}
                                    onChange={(e) => setDropdown2Value(e.target.value)}
                                    className="w-full p-4 border-2 border-gray-200 rounded-2xl text-base transition-all duration-200 focus:outline-none focus:border-indigo-500 focus:bg-indigo-50/30"
                                    disabled={isLoading}
                                >
                                    {dropdown2Options.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                                {dropdown2Value && (
                                    <p className="text-sm text-gray-600 italic">
                                        {dropdown2Options.find(opt => opt.value === dropdown2Value)?.description}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Project Name Input */}
                        <div className="space-y-3">
                            <label className="block text-base font-semibold text-gray-800 flex items-center">
                                <Sparkles className="w-4 h-4 mr-2 text-indigo-600" />
                                Project Name
                                <span className="text-sm font-normal text-gray-500 ml-2">(Optional)</span>
                            </label>
                            <input
                                type="text"
                                value={projectName}
                                onChange={(e) => setProjectName(e.target.value)}
                                placeholder="e.g., My React Dashboard, E-commerce Site..."
                                className="w-full p-4 border-2 border-gray-200 rounded-2xl text-base transition-all duration-200 focus:outline-none focus:border-indigo-500 focus:bg-indigo-50/30"
                                disabled={isLoading}
                            />
                            <p className="text-sm text-gray-600 italic">
                                Give your project a name to help organize the generated code
                            </p>
                        </div>

                        {/* Enhanced Send Button */}
                        <div className="pt-4">
                            <button
                                onClick={handleGenerate}
                                disabled={isLoading}
                                className={`w-full py-5 px-8 text-lg font-semibold rounded-2xl shadow-lg transition-all duration-200 transform ${
                                    !isLoading
                                        ? 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white shadow-indigo-200 hover:shadow-xl hover:-translate-y-0.5' 
                                        : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                                }`}
                            >
                                {isLoading ? (
                                    <div className="flex items-center justify-center">
                                        <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                                        Generating Response...
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center">
                                        <Send className="w-6 h-6 mr-3" />
                                        Get AI Assistance
                                    </div>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            
                {/* Enhanced Error Message Display */}
                {error && (
                    <div className={`bg-red-50 border border-red-200 text-red-700 p-6 rounded-2xl shadow-md transition-all duration-500 ease-out mb-8 ${
                        isPageLoaded 
                            ? 'opacity-100 translate-y-0' 
                            : 'opacity-0 translate-y-4'
                    }`} role="alert">
                        <div className="flex items-center">
                            <AlertTriangle className="w-5 h-5 mr-3 text-red-600" />
                            <p className="font-semibold">Something went wrong</p>
                        </div>
                        <p className="text-sm mt-2 ml-8">{error}</p>
                    </div>
                )}

                {/* Enhanced Results Display */}
                <div className={`transition-all duration-1000 delay-600 ease-out ${
                    isPageLoaded 
                        ? 'opacity-100 translate-y-0' 
                        : 'opacity-0 translate-y-8'
                }`}>
                    {chatResponse && (
                        <div ref={responseRef} className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 mb-8">
                            <h3 className="text-2xl font-bold text-gray-800 mb-6 flex items-center">
                                <MessageSquare className="w-6 h-6 mr-3 text-indigo-600" />
                                AI Response
                            </h3>
                            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-6 border border-indigo-100">
                                <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                                    {chatResponse}
                                </div>
                            </div>
                            
                            {/* Download Section */}
                            {downloadUrl && zipFileName && (
                                <div className="mt-6 bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6 border border-green-200">
                                    <div className="text-center">
                        <h4 className="text-lg font-semibold text-gray-800 mb-2 flex items-center justify-center">
                            <CheckCircle className="w-5 h-5 mr-2 text-green-600" />
                            Project Ready for Download
                        </h4>
                        
                        <p className="text-gray-600 mb-4">
                            <span className="font-medium">Project Name:</span> 
                            <span className="ml-2 font-mono text-sm bg-gray-100 px-2 py-1 rounded">
                                {generatedResult?.actualProjectName || "Generated Project"}
                            </span>
                        </p>                                        <button
                                            onClick={handleDownload}
                                            className="flex items-center justify-center mx-auto px-8 py-3 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-semibold rounded-xl shadow-lg transition-all duration-200 transform hover:scale-105 hover:shadow-xl"
                                        >
                                            <Download className="w-5 h-5 mr-2" />
                                            Download Project ZIP
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                    
                    {/* Enhanced Next Steps Dropdown */}
                    {/* {showNextSteps && chatResponse && (
                        <div className={`bg-white rounded-3xl shadow-xl border border-gray-100 p-8 transition-all duration-500 ease-out transform ${
                            showNextSteps 
                                ? 'opacity-100 translate-y-0 scale-100' 
                                : 'opacity-0 -translate-y-4 scale-95'
                        }`}>
                            <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
                                <Sparkles className="w-5 h-5 mr-3 text-indigo-600" />
                                What would you like to explore next?
                            </h3>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {nextStepSuggestions.map((suggestion, index) => (
                                    <button
                                        key={index}
                                        onClick={() => handleNextStepClick(suggestion)}
                                        className="text-left p-4 text-sm bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 border border-indigo-200 rounded-xl transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 group"
                                        disabled={isLoading}
                                    >
                                        <div className="flex items-center">
                                            <div className="w-2 h-2 bg-indigo-600 rounded-full mr-3 group-hover:bg-purple-600 transition-colors"></div>
                                            {suggestion}
                                        </div>
                                    </button>
                                ))}
                            </div>
                            <div className="flex justify-center mt-6">
                                <button
                                    onClick={() => setShowNextSteps(false)}
                                    className="text-gray-600 hover:text-gray-800 text-sm underline transition-colors"
                                >
                                    Hide suggestions
                                </button>
                            </div>
                        </div>
                    )} */}
                </div>
            </div>
        </div>
    );
};
 
export default App;