/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { 
  auth, 
  db 
} from "./lib/firebase";
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User
} from "firebase/auth";
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  orderBy,
  Timestamp,
  doc,
  setDoc,
  getDoc
} from "firebase/firestore";
import { 
  Phone, 
  Upload, 
  LogOut, 
  Search, 
  Filter, 
  ChevronRight, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Loader2,
  Plus,
  FileAudio,
  Calendar,
  User as UserIcon,
  Table,
  ExternalLink
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "./lib/utils";

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

interface CallReview {
  id: string;
  filename: string;
  timestamp: any;
  transcript: string;
  analysis: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  userId: string;
}

// --- Error Handler ---
function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  // In a real app, we might show a toast here
}

import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<CallReview[]>([]);
  const [selectedReview, setSelectedReview] = useState<CallReview | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [googleTokens, setGoogleTokens] = useState<any>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [spreadsheetId, setSpreadsheetId] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setGoogleTokens(event.data.tokens);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoading(false);

      if (currentUser) {
        // Ensure user document exists
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (!userDoc.exists()) {
          await setDoc(userDocRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            role: "user"
          });
        }
      }
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) {
      setReviews([]);
      return;
    }

    const path = "callReviews";
    const q = query(
      collection(db, path),
      where("userId", "==", user.uid),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedReviews = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as CallReview[];
      setReviews(fetchedReviews);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleConnectSheets = async () => {
    try {
      const response = await fetch("/api/auth/google/url");
      const { url } = await response.json();
      window.open(url, "google_oauth", "width=600,height=700");
    } catch (error) {
      console.error("Failed to get auth URL:", error);
    }
  };

  const handleExportToSheets = async (review: CallReview) => {
    if (!googleTokens) {
      handleConnectSheets();
      return;
    }

    if (!spreadsheetId) {
      const id = prompt("Please enter your Google Spreadsheet ID (found in the URL):");
      if (!id) return;
      setSpreadsheetId(id);
    }

    setIsExporting(true);
    try {
      const response = await fetch("/api/sheets/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokens: googleTokens,
          spreadsheetId: spreadsheetId || prompt("Spreadsheet ID:"),
          values: [
            review.timestamp?.toDate().toLocaleString(),
            review.filename,
            review.sentiment,
            review.analysis,
            review.transcript.substring(0, 1000) // Limit size for sheets
          ]
        })
      });

      if (response.ok) {
        alert("Successfully exported to Google Sheets!");
      } else {
        throw new Error("Export failed");
      }
    } catch (error) {
      console.error("Export error:", error);
      alert("Failed to export. Check your Spreadsheet ID and permissions.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    setUploadProgress("Analyzing audio with Gemini AI...");

    try {
      // Read file as base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const prompt = `
        You are a customer service assistant. 
        1. Transcribe the provided audio call.
        2. Analyze the transcript for Good reviews/Positive feedback and Bad reviews/Negative feedback.
        3. Determine the overall sentiment (positive, negative, or neutral).
        
        Return the result in JSON format:
        {
          "transcript": "...",
          "analysis": "...",
          "sentiment": "positive|negative|neutral"
        }
      `;

      const result = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  data: base64Data,
                  mimeType: file.type
                }
              }
            ]
          }
        ],
        config: {
          responseMimeType: "application/json"
        }
      });

      const analysisResult = JSON.parse(result.text || "{}");

      if (!analysisResult.transcript) {
        throw new Error("AI failed to generate transcript");
      }

      // Save to Firestore
      const path = "callReviews";
      await addDoc(collection(db, path), {
        filename: file.name,
        timestamp: Timestamp.now(),
        transcript: analysisResult.transcript,
        analysis: analysisResult.analysis,
        sentiment: analysisResult.sentiment,
        userId: user.uid
      });

      setUploadProgress("Analysis complete!");
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(null);
      }, 2000);
    } catch (error) {
      console.error("Upload failed:", error);
      setUploadProgress("Error processing file. Please check your connection.");
      setTimeout(() => setIsUploading(false), 3000);
    }
  };

  const filteredReviews = reviews.filter(r => 
    r.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.transcript.toLowerCase().includes(searchQuery.toLowerCase()) ||
    r.analysis.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center font-mono">
        <Loader2 className="w-8 h-8 animate-spin text-[#141414]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#E4E3E0] flex flex-col items-center justify-center p-6 font-mono text-[#141414]">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full text-center space-y-8"
        >
          <div className="space-y-2">
            <div className="flex justify-center">
              <div className="p-4 border-2 border-[#141414] rounded-full">
                <Phone className="w-12 h-12" />
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tighter uppercase">CallReview AI</h1>
            <p className="text-sm opacity-60 italic">Automated transcription & sentiment analysis</p>
          </div>
          
          <button 
            onClick={handleLogin}
            className="w-full py-4 border-2 border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-all duration-300 font-bold uppercase tracking-widest flex items-center justify-center gap-2"
          >
            Connect with Google
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-mono selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Header */}
      <header className="border-b border-[#141414] p-4 flex items-center justify-between sticky top-0 bg-[#E4E3E0]/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <Phone className="w-6 h-6" />
          <h1 className="text-xl font-bold uppercase tracking-tight">CallReview AI</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-2 text-xs opacity-60">
            <UserIcon className="w-3 h-3" />
            <span>{user.email}</span>
          </div>
          <button 
            onClick={handleLogout}
            className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors rounded-full"
            title="Logout"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: List */}
        <div className="lg:col-span-5 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-[0.2em] opacity-50 italic">Recent Recordings</h2>
            <button 
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-2 px-4 py-2 bg-[#141414] text-[#E4E3E0] hover:opacity-90 transition-opacity text-xs font-bold uppercase tracking-widest disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              New Review
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileUpload} 
              className="hidden" 
              accept="audio/*"
            />
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
            <input 
              type="text"
              placeholder="SEARCH TRANSCRIPTS..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border border-[#141414]/20 p-3 pl-10 text-xs focus:outline-none focus:border-[#141414] transition-colors uppercase tracking-wider"
            />
          </div>

          {/* List */}
          <div className="space-y-1 border-t border-[#141414]/10 pt-4">
            {isUploading && (
              <div className="p-4 border-2 border-dashed border-[#141414] animate-pulse flex items-center gap-4">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-xs font-bold uppercase">{uploadProgress}</span>
              </div>
            )}

            {filteredReviews.length === 0 && !isUploading ? (
              <div className="p-12 text-center opacity-40 italic text-sm">
                No recordings found.
              </div>
            ) : (
              filteredReviews.map((review) => (
                <motion.div
                  layoutId={review.id}
                  key={review.id}
                  onClick={() => setSelectedReview(review)}
                  className={cn(
                    "group p-4 border border-transparent hover:border-[#141414] cursor-pointer transition-all flex items-center justify-between",
                    selectedReview?.id === review.id && "bg-[#141414] text-[#E4E3E0]"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "p-2 rounded-full",
                      selectedReview?.id === review.id ? "bg-[#E4E3E0] text-[#141414]" : "bg-[#141414]/5"
                    )}>
                      <FileAudio className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold truncate max-w-[200px]">{review.filename}</h3>
                      <div className="flex items-center gap-2 text-[10px] opacity-60 uppercase">
                        <Calendar className="w-3 h-3" />
                        <span>{review.timestamp?.toDate().toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    {review.sentiment === 'positive' && <CheckCircle2 className="w-4 h-4 text-green-600" />}
                    {review.sentiment === 'negative' && <XCircle className="w-4 h-4 text-red-600" />}
                    {review.sentiment === 'neutral' && <AlertCircle className="w-4 h-4 text-blue-600" />}
                    <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* Right Column: Detail */}
        <div className="lg:col-span-7">
          <AnimatePresence mode="wait">
            {selectedReview ? (
              <motion.div
                key={selectedReview.id}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="border-2 border-[#141414] p-6 md:p-8 space-y-8 sticky top-24"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h2 className="text-2xl font-bold tracking-tighter uppercase">{selectedReview.filename}</h2>
                    <p className="text-xs opacity-50 uppercase tracking-widest">
                      Processed on {selectedReview.timestamp?.toDate().toLocaleString()}
                    </p>
                  </div>
                  <div className={cn(
                    "px-3 py-1 text-[10px] font-bold uppercase tracking-widest border border-[#141414]",
                    selectedReview.sentiment === 'positive' && "bg-green-100 text-green-800",
                    selectedReview.sentiment === 'negative' && "bg-red-100 text-red-800",
                    selectedReview.sentiment === 'neutral' && "bg-blue-100 text-blue-800"
                  )}>
                    {selectedReview.sentiment}
                  </div>
                </div>

                <div className="flex gap-4">
                  <button 
                    onClick={() => handleExportToSheets(selectedReview)}
                    disabled={isExporting}
                    className="flex items-center gap-2 px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#E4E3E0] transition-all text-[10px] font-bold uppercase tracking-widest disabled:opacity-50"
                  >
                    {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Table className="w-3 h-3" />}
                    {googleTokens ? "Export to Sheets" : "Connect Google Sheets"}
                  </button>
                  {spreadsheetId && (
                    <a 
                      href={`https://docs.google.com/spreadsheets/d/${spreadsheetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-4 py-2 border border-[#141414]/20 hover:border-[#141414] transition-all text-[10px] font-bold uppercase tracking-widest"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Open Sheet
                    </a>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 italic">AI Analysis</h3>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap border-l-2 border-[#141414] pl-4">
                      {selectedReview.analysis}
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <h3 className="text-[10px] font-bold uppercase tracking-[0.3em] opacity-40 italic">Transcript</h3>
                    <div className="text-sm leading-relaxed opacity-80 max-h-[400px] overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-[#141414]">
                      {selectedReview.transcript}
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <div className="h-full min-h-[400px] border-2 border-dashed border-[#141414]/20 flex flex-col items-center justify-center p-12 text-center space-y-4">
                <div className="p-6 bg-[#141414]/5 rounded-full">
                  <FileAudio className="w-12 h-12 opacity-20" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold uppercase opacity-40">Select a recording to view analysis</p>
                  <p className="text-xs opacity-30 italic">Transcripts and sentiment will appear here</p>
                </div>
              </div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[#141414] p-8 mt-12">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] uppercase tracking-widest opacity-40">
          <p>© 2026 CALLREVIEW AI SYSTEM</p>
          <div className="flex gap-8">
            <span>TRANSCRIPTION: GEMINI 1.5 FLASH</span>
            <span>STORAGE: FIRESTORE</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

