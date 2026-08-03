import React, { useState, useEffect, useMemo, useRef } from "react";

import { generate_mnemonic } from "./pkg/richiesafe_wasm";
// import wasmUrl from "./pkg/richiesafe_wasm_bg.wasm?url"; 
import { storage } from "./utils/storage";
import { App as CapApp } from "@capacitor/app";
import { StatusBar, Style } from "@capacitor/status-bar";
import { NativeBiometric } from "@capgo/capacitor-native-biometric";
import {
  Shield,
  Lock,
  Key,
  FileText,
  CreditCard,
  Settings,
  Search,
  Plus,
  Copy,
  Eye,
  EyeOff,
  Clock,
  ExternalLink,
  ShieldCheck,
  Moon,
  Sun,
  Menu,
  X,
  LogOut,
  ChevronRight,
  Image as ImageIcon,
} from "lucide-react";
import { listenAuth, logoutFirebase, loginEmail, registerEmail, loginGoogle, loginGooglePopup, handleGoogleRedirect } from "./auth";
import { auth } from "./firebase";
import { initialSync, listenRemoteChanges, pushLocal, bumpLocalMeta, deleteRemoteVault } from "./sync";
import { useSecurity } from "./context/SecurityContext";


const STORAGE_KEY = "richiesafe_vault_blob";

/* ------------------------------ Helpers ------------------------------ */
function getErrorMessage(error) {
  const msg = String(error?.message || error).toLowerCase();

  // Suppress technical initial state error commonly seen on load
  if (msg.includes("missing initial state")) return "";

  if (msg.includes("client is offline") || msg.includes("network-request-failed") || msg.includes("unavailable"))
    return "Sem ligação ou bloqueado pelo browser (Modo Privado?).";

  if (msg.includes("auth/unauthorized-domain"))
    return "Domínio não autorizado. Adiciona este site na Consola Firebase > Auth.";

  if (msg.includes("popup-closed-by-user") || msg.includes("cancelled-popup-request"))
    return "Janela de login fechada.";

  if (msg.includes("wrong-password")) return "Password incorreta.";
  if (msg.includes("user-not-found")) return "Conta não encontrada.";
  if (msg.includes("email-already-in-use")) return "Email já registado.";
  if (msg.includes("weak-password")) return "Password fraca.";
  if (msg.includes("too-many-requests")) return "Muitas tentativas. Aguarda um pouco.";

  return msg.replace("Firebase: ", "").replace("Error (auth/", "").replace(").", "");
}
async function writeClipboardSafe(text) {
  // Prefer modern async Clipboard API
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallthrough to legacy
    }
  }

  // Legacy fallback (best-effort)
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.top = "-9999px";
    el.style.left = "-9999px";
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function safeUrl(url) {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    // hard allowlist
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function getModeFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const mode = (params.get("mode") || "").toLowerCase();
    if (mode === "web" || mode === "emergency") return mode;
  } catch { }
  return "app";
}

function downloadBytes(filename, bytesU8) {
  try {
    const blob = new Blob([bytesU8], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Download failed", e);
    alert("Falha ao exportar ficheiro.");
  }
}

function isProbablyMnemonic(s) {
  // Very light heuristic: 12+ words, letters/spaces only.
  const t = String(s || "").trim().toLowerCase();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 12) return false;
  // allow accented letters too
  if (!/^[\p{L}\s]+$/u.test(t)) return false;
  return true;
}

/* ------------------------------ Confirm Modal ------------------------------ */
function ConfirmModal({ open, title, message, onConfirm, onCancel, isDarkMode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div
        className={`w-[90%] max-w-sm rounded-2xl p-6 shadow-2xl ${isDarkMode ? "bg-[#1a1a2e] text-white border border-slate-700" : "bg-white text-black"
          }`}
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className="text-lg font-bold mb-2">{title}</h3>}
        <p className={`text-sm mb-6 whitespace-pre-line ${isDarkMode ? "text-slate-300" : "text-slate-600"}`}>{message}</p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className={`flex-1 py-3 rounded-xl font-semibold transition-colors ${isDarkMode ? "bg-slate-700 hover:bg-slate-600 text-white" : "bg-slate-200 hover:bg-slate-300 text-black"
              }`}
          >Cancelar</button>
          <button
            onClick={onConfirm}
            className="flex-1 py-3 rounded-xl font-semibold bg-red-600 hover:bg-red-700 text-white transition-colors"
          >Confirmar</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ Auth Screen ------------------------------ */

async function nukeFirebaseData() {
  try {
    if (window.indexedDB && window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name && (db.name.includes("firebase") || db.name.includes("firestore"))) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.includes("firebase")) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.setItem("richiesafe_nuked", "true");
  } catch (e) {
    console.warn("Nuke failed:", e);
  }
}

const LogoEscudo = ({ size = 32, className = "" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const AuthScreen = ({ isDarkMode, setIsDarkMode, user, onReset, setNeedsPinReset, setTempRecoveryKey }) => {
  const { unlock, create, isReady } = useSecurity();
  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  const [isLocked, setIsLocked] = useState(false); // TRUE if PIN correct but Biometric failed
  const [hasVault, setHasVault] = useState(false); // Local state for AuthScreen vault existence check

  // ---- Sessão (Firebase Auth) - opcional ----
  const [authMode, setAuthMode] = useState("welcome"); // "welcome" | "create" | "login" | "register"
  const [email, setEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMsg, setAuthMsg] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [showCloudSync, setShowCloudSync] = useState(false); // Collapsible Cloud Sync section
  const [canRetryPopup, setCanRetryPopup] = useState(false); // New state for popup retry


  // Handle any pending Google redirect result on page load (silent)
  useEffect(() => {
    const processGoogleRedirect = async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("error")) {
        setAuthErr(`Erro no URL: ${params.get("error")} - ${params.get("error_description")}`);
      }
      try {
        const result = await handleGoogleRedirect();
        if (result?.user) {
          setAuthMsg("Sessão iniciada com Google.");
        }
      } catch (e) {
        // Silent — popup is now primary, redirect errors are noise
      }
    };
    processGoogleRedirect();
  }, []);

  // Auto-sync when user prop changes (e.g., after redirect or already authenticated)
  useEffect(() => {
    if (!user) return;

    // In "create" mode, user just logged in to associate their account.
    // Don't run full sync — there's no vault yet. Just confirm auth.
    if (authMode === "create") {
      setAuthMsg("");
      setAuthErr("");
      return;
    }

    const checkVault = async () => {
      setAuthLoading(true);
      setAuthMsg("A verificar cofre...");
      try {
        const syncResult = await initialSync(STORAGE_KEY);
        console.log("Sync result:", syncResult);

        // If we succeeded, clear the nuke flag so we can nuke again if needed later
        sessionStorage.removeItem("richiesafe_nuked");

        if (syncResult.mode !== "empty" && syncResult.mode !== "offline") {
          setHasVault(true);
          if (syncResult.mode === "offline_fallback") {
            setAuthMsg("Modo Offline: Usando cópia local.");
          } else {
            setAuthMsg("Cofre encontrado. Introduz o PIN.");
          }
        } else {
          setAuthMsg("Nenhum cofre encontrado. Cria um novo cofre.");
          setAuthMode("create");
        }
      } catch (e) {
        console.warn("Vault check failed:", e);
        const errMsg = getErrorMessage(e);
        setAuthErr(errMsg);

        // "Target ID" error = Firestore corruption. Fall back to offline mode.
        if (errMsg.includes("Target ID") || String(e).includes("Target ID")) {
          setAuthErr("");
          setAuthMsg("Sem acesso à nuvem. A usar modo offline.");
          // Check if local vault exists
          const localBlob = localStorage.getItem(STORAGE_KEY);
          if (localBlob) {
            setHasVault(true);
          }
        }
      } finally {
        setAuthLoading(false);
      }
    };

    checkVault();
  }, [user]);

  const doEmailAuth = async () => {
    setAuthErr("");
    setAuthMsg("");

    if (!email || !authPass) {
      setAuthErr("Preenche email e password.");
      return;
    }

    setAuthLoading(true);
    try {
      if (authMode === "login") {
        await loginEmail(email.trim(), authPass);
        setAuthMsg("Sessão iniciada.");
      } else {
        if (authPass.length < 8) {
          setAuthErr("Password fraca (mínimo 8 caracteres).");
          return;
        }
        await registerEmail(email.trim(), authPass);
        setAuthMsg("Conta criada e sessão iniciada.");
      }
      setAuthPass("");
    } catch (e) {
      console.error(e);
      setAuthErr(getErrorMessage(e));
    } finally {
      setAuthLoading(false);
    }
  };

  const doGoogle = async () => {
    setAuthErr("");
    setAuthMsg("");
    setAuthLoading(true);
    try {
      const result = await loginGoogle();
      if (result?.user) {
        setAuthMsg("Sessão iniciada com Google.");
      }
    } catch (e) {
      console.error(e);
      setAuthErr(getErrorMessage(e));
    } finally {
      setAuthLoading(false);
    }
  };

  const continueOffline = () => {
    setAuthMsg("Modo offline (sem sincronização).");
    setAuthErr("");
  };

  // Sensitive inputs
  const [pin, setPin] = useState("");
  const [panicPin, setPanicPin] = useState("");
  const [recovery, setRecovery] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isRecovering, setIsRecovering] = useState(false);

  // Sync Status State
  const [syncStatus, setSyncStatus] = useState(navigator.onLine ? "online" : "offline");
  const [lastSync, setLastSync] = useState(null);

  // Sync Status Effect
  useEffect(() => {
    const handleOnline = () => setSyncStatus("online");
    const handleOffline = () => setSyncStatus("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // StrictMode guard
  const generatedOnceRef = useRef(false);

  useEffect(() => {
    storage.get("richiesafe_vault_blob").then((blob) => {
      setHasVault(!!blob);
    });
  }, []);

  const checkBiometrics = async () => {
    try {
      const result = await NativeBiometric.isAvailable();
      if (result.isAvailable) {
        // Auto-enable if not set (First Run / Default)
        if (localStorage.getItem("richiesafe_bio_enabled") === null) {
          console.log("Biometrics available. Auto-enabling default.");
          localStorage.setItem("richiesafe_bio_enabled", "true");
        }
      }
    } catch (e) {
      console.log("Biometric check failed/cancelled", e);
    }
  };

  const handleGenerateRecovery = () => {
    if (!isReady) return;
    try {
      if (generatedOnceRef.current && recovery) return;
      const phrase = generate_mnemonic(); // Still using direct import for util, or WASM export
      // const phrase = "recovery_phrase_placeholder"; // DEBUG: Temporary placeholder
      setRecovery(phrase);
      generatedOnceRef.current = true;
    } catch (e) {
      console.error("Failed to generate mnemonic", e);
      setError("Não foi possível gerar frase de recuperação.");
    }
  };

  const clearSensitiveInputs = () => {
    setPin("");
    setPanicPin("");
    setRecovery("");
    setRecoveryKey("");
  };

  const handleCreate = async () => {
    // Redeploy: Secrets Added
    if (!pin || !panicPin || !recovery) {
      setError("Preencha todos os campos.");
      return;
    }
    if (pin.length < 4 || panicPin.length < 4) {
      setError("O PIN deve ter pelo menos 4 dígitos.");
      return;
    }
    if (pin === panicPin) {
      setError("O PIN mestre e o PIN de pânico têm de ser diferentes.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Use Security Context to create vault pair
      // Now supporting panicPin and decoy persist
      const pair = await create(pin, recovery, panicPin);

      // Persist Real Blob
      await storage.set("richiesafe_vault_blob", JSON.stringify(Array.from(pair.real)));

      // Persist Decoy Blob
      await storage.set("richiesafe_vault_decoy", JSON.stringify(Array.from(pair.decoy)));

      // SYNC: Bump meta + Push
      bumpLocalMeta();
      await pushLocal("richiesafe_vault_blob");

      // Auto unlock via context (Unlock REAL vault by default on creation)
      await unlock(pair.real, pin);

      // 2. Auto-Enable Biometrics (2FA) if available
      try {
        const result = await NativeBiometric.isAvailable();
        if (result.isAvailable) {
          console.log("Biometrics available. Auto-enabling for new vault.");
          if (isNativeApp) {
            await NativeBiometric.setCredentials({
              username: "user",
              password: pin,
              server: "richiesafe.app",
            });
          } else {
            // Browser WebAuthn fallback
            await webAuthnBiometrics.register(pin);
          }
          localStorage.setItem("richiesafe_bio_enabled", "true");
        }
      } catch (bioSetupErr) {
        console.warn("Auto-bio setup failed", bioSetupErr);
      }

      clearSensitiveInputs();
    } catch (e) {
      setError("Erro ao criar cofre: " + e.message);
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async () => {
    setLoading(true);
    setError("");

    try {
      const realBlobJson = await storage.get("richiesafe_vault_blob");
      if (!realBlobJson) throw new Error("Cofre não encontrado.");

      const realBlob = new Uint8Array(JSON.parse(realBlobJson));

      // 1. Context Verify/Unlock
      try {
        await unlock(realBlob, pin); // Try Real Vault
      } catch (realErr) {
        // Failed real unlock. Try Decoy?
        const decoyBlobJson = await storage.get("richiesafe_vault_decoy");
        if (decoyBlobJson) {
          try {
            const decoyBlob = new Uint8Array(JSON.parse(decoyBlobJson));
            await unlock(decoyBlob, pin); // Try Decoy Vault (pin input variable holds the entered pin)
            // If successful, we are now authenticated with the DECOY handle.
            console.warn("PANIC MODE ACTIVATED");
            return; // Exit success
          } catch (decoyErr) {
            // Both failed
            throw realErr; // Throw original error
          }
        } else {
          throw realErr;
        }
      }

      // 2. Strict Biometric Check (if enabled)
      // Only enforce for REAL vault? Or both? 
      // If we are here, we unlocked the REAL vault. Decoy implies panic, so maybe skip biometrics for decoy?
      // Logic above returns early on decoy success, so we only reach here for Real Vault.



      clearSensitiveInputs();
    } catch (e) {
      console.error("Unlock Error Details:", e);
      // Differentiate between "Wrong PIN" (Tag mismatch) and System Errors (Storage/JSON)
      const errStr = String(e);
      if (errStr.includes("Biometria")) {
        setError(e.message);
      } else if (errStr.includes("syntax") || errStr.includes("JSON")) {
        setError("Erro de dados (Corrupção de Ficheiro Local).");
      } else {
        setError("PIN incorreto."); // Default safe error
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRecover = async () => {
    setLoading(true);
    setError("");

    try {
      const blobJson = await storage.get("richiesafe_vault_blob");
      if (!blobJson) throw new Error("Cofre não encontrado.");

      if (!isProbablyMnemonic(recoveryKey) && recoveryKey.trim().length < 8) {
        setError("Chave de recuperação inválida.");
        setLoading(false);
        return;
      }

      const blob = new Uint8Array(JSON.parse(blobJson));
      // Unlock with recovery key via context (assuming unlock supports it or password fallback)
      await unlock(blob, recoveryKey);

      // Trigger forced PIN reset after recovery success
      setTempRecoveryKey(recoveryKey);
      setNeedsPinReset(true);

      clearSensitiveInputs();
    } catch (e) {
      setError("Chave de recuperação inválida ou erro.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // RENDER LOCKED SCREEN OVERLAY
  if (isLocked) {
    return (
      <LockedScreen
        isDarkMode={isDarkMode}
        onRetry={async () => {
          try {
            const verified = await NativeBiometric.verifyIdentity({
              reason: "Desbloquear Aplicação",
              title: "Ecrã Bloqueado",
              subtitle: "Autenticação Biométrica",
              description: "Confirma a tua identidade.",
            });
            if (verified) {
              setIsLocked(false);
              clearSensitiveInputs();
            }
          } catch (e) {
            // Stay locked
          }
        }}
      />
    );
  }

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-300 ${isDarkMode ? "bg-[#0a0a0c]" : "bg-white"
        }`}
    >
      <ConfirmModal
        open={!!confirmModal}
        title={confirmModal?.title}
        message={confirmModal?.message}
        onConfirm={() => { setConfirmModal(null); confirmModal?.onConfirm(); }}
        onCancel={() => setConfirmModal(null)}
        isDarkMode={isDarkMode}
      />
      <div
        className={`w-full max-w-md rounded-[2.5rem] p-8 lg:p-10 relative overflow-hidden transition-all duration-300 ${isDarkMode
          ? "bg-[#111114] shadow-2xl border border-slate-800"
          : "bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] border border-slate-100"
          }`}
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
        {/* Version Marker for Debugging */}
        <div className="absolute top-2 right-2 text-[9px] text-slate-400 font-mono opacity-50 z-50 flex flex-col items-end gap-1">
          <span>v2.6</span>
          <button
            onClick={() => {
              setConfirmModal({
                title: "Reset App",
                message: "Isto vai limpar todos os dados da app (Firebase + cofre local).\n\nQueres continuar?",
                onConfirm: async () => {
                  await nukeFirebaseData();
                  storage.remove("richiesafe_vault_blob");
                  storage.remove("richiesafe_vault_decoy");
                  localStorage.removeItem("richiesafe_theme");
                  window.location.reload();
                }
              });
            }}
            className="underline hover:text-red-500 cursor-pointer pointer-events-auto"
          >
            Reset App
          </button>
        </div>



        {/* NORMAL UI START */}
        <div className="flex justify-between items-start mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <LogoEscudo className="text-white" size={32} />
          </div>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            style={{ backgroundColor: isDarkMode ? "" : "#FFFFFF" }}
            className="p-3 rounded-xl bg-white border border-slate-100 dark:bg-slate-900 dark:border-transparent text-slate-500 hover:scale-105 transition-transform shadow-sm"
          >
            {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
          </button>
        </div>

        <h1
          className="text-3xl font-black mb-2 tracking-tight"
          style={{ color: isDarkMode ? "#ffffff" : "#000000" }}
        >
          RichieSafe
        </h1>
        <p className="text-slate-500 dark:text-slate-400 mb-8 font-medium">
          {hasVault
            ? "Bem-vindo de volta. Insira o seu PIN."
            : (authMode === "login" ? "Entre na sua conta para sincronizar." : "Crie o seu novo cofre encriptado.")}
        </p>

        {/* ---- CONDITIONAL UI BASED ON STATE ---- */}

        {/* 1. HAS VAULT -> UNLOCK SCREEN */}
        {hasVault && (
          <div className="space-y-5">
            {/* Header with User Info & Logout */}
            {user && (
              <div className="bg-indigo-50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/30 rounded-2xl p-4 flex items-center justify-between animate-in fade-in slide-in-from-top-4 duration-500">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-300 font-bold text-xs shrink-0 shadow-sm">
                    {user.email?.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest leading-none mb-1">Conectado como</p>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate leading-none">{user.email}</p>
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    setHasVault(false);
                    setAuthMode("welcome");
                    await logoutFirebase();
                  }}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-[10px] font-bold text-slate-500 hover:text-red-500 hover:border-red-200 transition-colors uppercase tracking-wide shrink-0 shadow-sm"
                >
                  Sair
                </button>
              </div>
            )}
            {isRecovering ? (
              <div className="space-y-2 animate-in fade-in zoom-in duration-300">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                  CHAVE DE RECUPERAÇÃO
                </label>
                <textarea
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  className="w-full bg-[#fafafa] dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500/50 text-slate-900 dark:text-white transition-all shadow-sm min-h-[120px]"
                  placeholder="Introduza a sua frase de recuperação..."
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                />
              </div>
            ) : (
              <div className="space-y-2 animate-in fade-in zoom-in duration-300">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                  PIN MESTRE
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  style={{ backgroundColor: isDarkMode ? "" : "#FAFAFA", color: isDarkMode ? "white" : "black" }}
                  className="w-full border border-slate-100 dark:border-slate-800 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-sm tracking-widest font-bold"
                  placeholder="••••••"
                  autoComplete="current-password"
                  inputMode="numeric"
                />
              </div>
            )}

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl text-xs font-bold text-center animate-pulse">
                {error}
              </div>
            )}

            <button
              onClick={isRecovering ? handleRecover : handleUnlock}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50 mt-4"
            >
              {loading ? "A verificar..." : isRecovering ? "Recuperar Cofre" : "Desbloquear"}
            </button>

            <button
              onClick={() => {
                setIsRecovering(!isRecovering);
                setError("");
                setPin("");
                setRecoveryKey("");
              }}
              className="w-full text-center text-sm font-medium text-slate-400 hover:text-indigo-500 transition-colors mt-4"
            >
              {isRecovering ? "Voltar ao PIN" : "Esqueceste-te da password?"}
            </button>

            {/* Logout / Switch Account Option */}
            <button
              onClick={async () => {
                await logoutFirebase();
                setHasVault(false);
                setAuthMode("login");
                setPin("");
                setError("");
              }}
              className="w-full text-center text-[10px] font-bold text-red-400 hover:text-red-500 uppercase tracking-widest mt-6 transition-colors"
            >
              Sair / Trocar Conta
            </button>

            {/* Sync / Login Option for Offline Users with Vault */}
            {!user && (
              <button
                onClick={() => {
                  setHasVault(false);
                  setAuthMode("login");
                }}
                className="w-full text-center text-[10px] font-bold text-slate-400 hover:text-indigo-500 uppercase tracking-widest mt-6 transition-colors"
                title="Entrar na conta para sincronizar"
              >
                Conectar Conta / Sincronizar
              </button>
            )}
          </div>
        )}

        {/* 2. NO VAULT -> WELCOME / CREATE / LOGIN FLOW */}
        {!hasVault && (
          <div className="space-y-6">



            {/* CASE A: CREATING VAULT (Logged in or not) */}
            {authMode === "create" ? (
              <div className="animate-in fade-in slide-in-from-right-8 duration-300">
                <div className="flex items-center gap-2 mb-6">
                  <button onClick={() => setAuthMode("welcome")} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <ChevronRight className="rotate-180" size={20} />
                  </button>
                  <h2 className="text-lg font-bold">Configurar Cofre</h2>
                </div>

                <div className="space-y-4">
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">PIN MESTRE</label>
                    <input
                      type="password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      className="w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors"
                      placeholder="••••••"
                      autoComplete="new-password"
                      inputMode="numeric"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-bold text-red-500 uppercase tracking-widest ml-1">PIN DE PÂNICO</label>
                    <input
                      type="password"
                      value={panicPin}
                      onChange={(e) => setPanicPin(e.target.value)}
                      className="w-full bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-900/30 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-red-500/50 font-bold tracking-widest text-red-600 dark:text-red-400 text-base"
                      placeholder="••••••"
                    />
                  </div>

                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-1">FRASE DE RECUPERAÇÃO</label>
                      <button onClick={handleGenerateRecovery} className="text-xs font-bold text-indigo-500 hover:text-indigo-400 uppercase">GERAR</button>
                    </div>
                    <textarea
                      value={recovery}
                      onChange={(e) => setRecovery(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500/50 min-h-[100px] text-slate-900 dark:text-white text-base"
                      placeholder="Gera ou cola a tua frase..."
                    />
                    <p className="text-xs text-slate-400">Guarda isto offline. É a única forma de recuperar o acesso.</p>
                  </div>

                  {error && <div className="text-red-500 text-xs font-bold text-center p-2">{error}</div>}

                  {/* Cloud Sync - Login before creating vault */}
                  <div className={`mt-4 rounded-2xl border overflow-hidden transition-all ${isDarkMode ? "border-slate-800 bg-slate-900/50" : "border-slate-200 bg-slate-50"}`}>
                    <button
                      onClick={() => setShowCloudSync(!showCloudSync)}
                      className={`w-full flex items-center justify-between px-5 py-3 text-sm font-semibold transition-colors ${isDarkMode ? "text-slate-300 hover:bg-slate-800" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      <span>☁️ Sincronização na Nuvem {user ? "✅" : "(Opcional)"}</span>
                      <ChevronRight className={`transition-transform ${showCloudSync ? "rotate-90" : ""}`} size={16} />
                    </button>
                    {showCloudSync && (
                      <div className="px-5 pb-4 space-y-3">
                        {user ? (
                          <div className={`text-xs p-3 rounded-xl ${isDarkMode ? "bg-green-500/10 text-green-400 border border-green-800" : "bg-green-50 text-green-700 border border-green-200"}`}>
                            <div className="flex justify-between items-center gap-2">
                              <div>
                                ✅ Conectado como <b>{user.email || "Anónimo"}</b>
                                <br /><span className="opacity-70">O cofre será sincronizado automaticamente.</span>
                              </div>
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  await logoutFirebase();
                                  setHasVault(false);
                                  setAuthMode("login");
                                  setPin("");
                                }}
                                className="px-2 py-1 bg-red-500 text-white text-[10px] font-bold rounded-lg hover:bg-red-600 transition-colors uppercase tracking-wide shrink-0"
                              >
                                Sair
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className={`text-[11px] ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
                              Faz login para guardar o cofre na nuvem e sincronizar entre dispositivos.
                            </p>
                            <div className="space-y-2">
                              <input
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className={`w-full rounded-xl px-4 py-2.5 outline-none text-sm transition-all ${isDarkMode
                                  ? "bg-slate-800 border border-slate-700 text-white focus:ring-2 focus:ring-indigo-500/50"
                                  : "bg-white border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500/30"
                                  }`}
                                placeholder="Email"
                                type="email"
                              />
                              <input
                                value={authPass}
                                onChange={(e) => setAuthPass(e.target.value)}
                                className={`w-full rounded-xl px-4 py-2.5 outline-none text-sm transition-all ${isDarkMode
                                  ? "bg-slate-800 border border-slate-700 text-white focus:ring-2 focus:ring-indigo-500/50"
                                  : "bg-white border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500/30"
                                  }`}
                                placeholder="Password"
                                type="password"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={doEmailAuth}
                                  disabled={authLoading}
                                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${isDarkMode
                                    ? "bg-slate-700 hover:bg-slate-600 text-white"
                                    : "bg-slate-200 hover:bg-slate-300 text-slate-700"
                                    }`}
                                >
                                  {authLoading ? "..." : "Entrar"}
                                </button>
                                <button
                                  onClick={doGoogle}
                                  disabled={authLoading}
                                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
                                >
                                  Google
                                </button>
                              </div>
                            </div>
                            {authErr && <div className="text-red-500 text-[11px] font-bold">{authErr}</div>}
                            {authMsg && <div className={`text-[11px] font-medium ${isDarkMode ? "text-indigo-400" : "text-indigo-600"}`}>{authMsg}</div>}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={handleCreate}
                    disabled={loading}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] mt-4"
                  >
                    {loading ? "A Criar Cofre..." : "Finalizar Configuração"}
                  </button>
                </div>
              </div>
            ) : user ? (
              /* CASE B: LOGGED IN BUT NO VAULT (or checking) */
              <div className="text-center space-y-4 animate-in fade-in zoom-in duration-300">
                <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl border border-indigo-100 dark:border-indigo-800/50">
                  <p className="text-xs text-indigo-500 dark:text-indigo-400 font-bold uppercase tracking-widest mb-1">CONECTADO COMO</p>
                  <p className="font-bold text-slate-700 dark:text-slate-200 truncate">{user.email}</p>
                </div>

                <div className="py-4">
                  {authLoading ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      <p className="text-sm font-medium text-slate-500">{authMsg || "A procurar cofre..."}</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {authMsg || "Nenhum cofre encontrado nesta conta."}
                      </p>

                      {/* If no vault found, offer to create one */}
                      <button
                        onClick={() => setAuthMode("create")}
                        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-2xl shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98]"
                      >
                        Criar Novo Cofre
                      </button>

                      <button
                        onClick={async () => {
                          setHasVault(false);
                          setAuthMode("welcome");
                          await logoutFirebase();
                        }}
                        className="w-full bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold py-3 rounded-2xl transition-all active:scale-[0.98]"
                      >
                        Sair / Trocar Conta
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* CASE C: NOT LOGGED IN -> WELCOME / LOGIN */
              <>
                {/* View Switching Logic */}
                {authMode === "welcome" && (
                  <div className="grid gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">

                    {/* Error Feedback on Welcome Screen */}
                    {(authErr || authMsg) && (
                      <div className={`p-4 rounded-xl text-xs font-bold text-center mb-2 ${authErr
                        ? "bg-red-500/10 border border-red-500/20 text-red-500"
                        : "bg-indigo-500/10 border border-indigo-500/20 text-indigo-400"
                        }`}>
                        {authErr || authMsg}
                      </div>
                    )}

                    <button
                      onClick={() => setAuthMode("create")}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                    >
                      <Plus size={20} />
                      Criar Novo Cofre
                    </button>
                    <button
                      onClick={() => setAuthMode("login")}
                      className={`w-full font-bold py-5 rounded-2xl border transition-all active:scale-[0.98] flex items-center justify-center gap-3 ${isDarkMode
                        ? "bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300"
                        : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm"
                        }`}
                    >
                      <Search size={20} />
                      Já Tenho Conta
                    </button>

                    {/* Popup Retry Button */}
                    {canRetryPopup && (
                      <button
                        onClick={doGoogle}
                        className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-4 rounded-2xl shadow-lg shadow-amber-500/20 transition-all active:scale-[0.98] flex items-center justify-center gap-3"
                      >
                        <Search size={20} />
                        Tentar via Popup
                      </button>
                    )}
                  </div>
                )}

                {authMode === "login" && (
                  <div className="animate-in fade-in slide-in-from-right-8 duration-300">
                    <div className="flex items-center gap-2 mb-6">
                      <button onClick={() => setAuthMode("welcome")} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <ChevronRight className="rotate-180 text-slate-900 dark:text-white" size={20} />
                      </button>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white">Entrar na Conta</h2>
                    </div>

                    <div className="space-y-4">
                      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 bg-slate-100 dark:bg-slate-900 p-3 rounded-xl border border-transparent dark:border-slate-800">
                        Faz login para sincronizar o teu cofre existente. Vais precisar do teu <b>PIN Mestre</b> para o desbloquear depois.
                      </p>

                      <div className="space-y-3">
                        <input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={`w-full rounded-2xl px-5 py-3 outline-none text-sm transition-all ${isDarkMode
                            ? "bg-slate-900/50 border border-slate-800 text-white focus:ring-2 focus:ring-indigo-500/50"
                            : "bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500/30"
                            }`}
                          placeholder="Email"
                          type="email"
                          autoComplete="email"
                        />
                        <input
                          value={authPass}
                          onChange={(e) => setAuthPass(e.target.value)}
                          className={`w-full rounded-2xl px-5 py-3 outline-none text-sm transition-all ${isDarkMode
                            ? "bg-slate-900/50 border border-slate-800 text-white focus:ring-2 focus:ring-indigo-500/50"
                            : "bg-slate-50 border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500/30"
                            }`}
                          placeholder="Password"
                          type="password"
                          autoComplete={authMode === "login" ? "current-password" : "new-password"}
                        />

                        {(authErr || authMsg) && (
                          <div className={`p-3 rounded-xl text-xs font-bold text-center ${authErr
                            ? "bg-red-500/10 border border-red-500/20 text-red-500"
                            : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-500"
                            }`}>
                            {authErr || authMsg}
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-3">
                          <button
                            onClick={async () => {
                              setAuthErr("");
                              try {
                                await doEmailAuth();
                                // doEmailAuth sets authErr on failure
                                // CHECK authErr state directly might be stale due to closure, check auth.currentUser instead?
                                // doEmailAuth is async and sets state. We should rely on try/catch inside doEmailAuth re-throwing?
                                // Actually doEmailAuth catches its own errors. We need to check if we have a user.

                                if (auth.currentUser) {
                                  setAuthLoading(true);
                                  setAuthMsg("A procurar cofre...");
                                  const res = await initialSync("richiesafe_vault_blob", (msg) => setAuthMsg(msg));
                                  if (res.mode !== "empty" && res.mode !== "offline") {
                                    setHasVault(true);
                                    if (res.mode === "offline_fallback") {
                                      setAuthErr(""); // Clear any previous error
                                      setAuthMsg("Modo Offline: Usando cópia local.");
                                    } else {
                                      setAuthMsg("");
                                    }
                                  } else {
                                    setAuthMsg("Nenhum cofre encontrado. Cria um novo cofre.");
                                    setAuthMode("create");
                                  }
                                }
                              } catch (e) {
                                console.error(e);
                                setAuthErr(getErrorMessage(e));
                                setAuthMsg("");
                              } finally {
                                setAuthLoading(false);
                              }
                            }}
                            disabled={authLoading}
                            className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-2xl shadow-lg shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-50"
                          >
                            {authLoading ? "..." : "Entrar"}
                          </button>

                          <button
                            onClick={async () => {
                              setAuthErr("");
                              try {
                                await doGoogle();
                                if (auth.currentUser) {
                                  setAuthLoading(true);
                                  setAuthMsg("A procurar cofre...");
                                  const res = await initialSync("richiesafe_vault_blob", (msg) => setAuthMsg(msg));
                                  if (res.mode !== "empty" && res.mode !== "offline") {
                                    setHasVault(true);
                                    if (res.mode === "offline_fallback") {
                                      setAuthErr("");
                                      setAuthMsg("Modo Offline: Usando cópia local.");
                                    } else {
                                      setAuthMsg("");
                                    }
                                  } else {
                                    setAuthMsg("Nenhum cofre encontrado. Cria um novo cofre.");
                                    setAuthMode("create");
                                  }
                                }
                              } catch (e) {
                                console.error(e);
                                setAuthErr(getErrorMessage(e));
                                setAuthMsg("");
                              } finally {
                                setAuthLoading(false);
                              }
                            }}
                            disabled={authLoading}
                            className={`font-bold py-3 rounded-2xl border active:scale-[0.98] disabled:opacity-50 ${isDarkMode
                              ? "bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                              : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm"
                              }`}
                            title="Login com Google"
                          >
                            Google
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ---- RESET VAULT (only when vault exists) ---- */}
        {hasVault && (
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
            <button
              onClick={onReset}
              className="text-[10px] font-bold text-red-400 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              Destruir Cofre (Reset)
            </button>
          </div>
        )}
      </div>
    </div >
  );
};

/* ------------------------------ Settings Panel ------------------------------ */

// Check if we're running in a native app (Capacitor) or browser
const isNativeApp = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

// WebAuthn helper for browser Touch ID/Face ID
const webAuthnBiometrics = {
  isSupported: () => {
    return window.PublicKeyCredential &&
      window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;
  },

  async checkAvailable() {
    if (!this.isSupported()) return false;
    try {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  },

  async register(pin) {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "RichieSafe", id: window.location.hostname },
        user: {
          id: new TextEncoder().encode("richiesafe-user"),
          name: "user@richiesafe",
          displayName: "RichieSafe User"
        },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },   // ES256 (P-256 + SHA-256) - Most common
          { type: "public-key", alg: -257 }, // RS256 (RSA + SHA-256) - Often needed for TPMs/Windows Hello/macOS
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          userVerification: "required",
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: "none"
      }
    });

    if (credential) {
      // Store credential ID and encrypted PIN
      const credId = btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
      localStorage.setItem("richiesafe_webauthn_cred", credId);
      localStorage.setItem("richiesafe_bio_pin", btoa(pin)); // Simple encoding for demo
      return true;
    }
    return false;
  },

  async authenticate() {
    const credId = localStorage.getItem("richiesafe_webauthn_cred");
    if (!credId) throw new Error("No credential registered");

    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const credential = await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: window.location.hostname,
        allowCredentials: [{
          type: "public-key",
          id: Uint8Array.from(atob(credId), c => c.charCodeAt(0))
        }],
        userVerification: "required",
        timeout: 60000
      }
    });

    if (credential) {
      const storedPin = localStorage.getItem("richiesafe_bio_pin");
      return storedPin ? atob(storedPin) : null;
    }
    return null;
  },

  delete() {
    localStorage.removeItem("richiesafe_webauthn_cred");
    localStorage.removeItem("richiesafe_bio_pin");
  }
};

const SettingsBiometricToggle = ({ isDarkMode }) => {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const checkBiometrics = async () => {
      if (isNativeApp) {
        // Native app - use Capacitor
        const stored = localStorage.getItem("richiesafe_bio_enabled") === "true";
        if (stored) {
          try {
            const creds = await NativeBiometric.getCredentials({ server: "richiesafe.app" });
            setEnabled(!!creds);
            setAvailable(true);
          } catch {
            setEnabled(false);
            setAvailable(true);
          }
        } else {
          setAvailable(true);
        }
      } else {
        // Browser - use WebAuthn
        const isAvailable = await webAuthnBiometrics.checkAvailable();
        setAvailable(isAvailable);
        if (isAvailable) {
          const hasCredential = !!localStorage.getItem("richiesafe_webauthn_cred");
          setEnabled(hasCredential);
        }
      }
    };
    checkBiometrics();
  }, []);

  const toggle = async () => {
    if (enabled) {
      // Disable biometrics
      if (isNativeApp) {
        await NativeBiometric.deleteCredentials({ server: "richiesafe.app" });
      } else {
        webAuthnBiometrics.delete();
      }
      localStorage.setItem("richiesafe_bio_enabled", "false");
      setEnabled(false);
    } else {
      // Enable biometrics
      const pin = prompt("Insere o teu PIN atual para ativar biometria:");
      if (!pin) return;

      try {
        if (isNativeApp) {
          await NativeBiometric.setCredentials({
            username: "user",
            password: pin,
            server: "richiesafe.app",
          });
        } else {
          const success = await webAuthnBiometrics.register(pin);
          if (!success) throw new Error("WebAuthn registration failed");
        }
        localStorage.setItem("richiesafe_bio_enabled", "true");
        setEnabled(true);
        alert("Biometria ativada!");
      } catch (e) {
        console.error("Biometric setup failed:", e);
        alert("Falha ao ativar biometria. Verifica se o teu dispositivo suporta Touch ID/Face ID.");
        localStorage.setItem("richiesafe_bio_enabled", "false");
      }
    }
  };

  if (!available) {
    return (
      <div className={`mb-6 p-4 rounded-2xl border ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
        <div>
          <h5 className={`font-bold text-sm ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>Segurança Máxima (2FA)</h5>
          <p className="text-xs text-slate-500">Biometria não disponível neste dispositivo</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-6 p-4 rounded-2xl border flex items-center justify-between ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
      <div>
        <h5 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-slate-900"}`}>Segurança Máxima (2FA)</h5>
        <p className="text-xs text-slate-500">
          {isNativeApp ? "Exige biometria ALÉM do PIN" : "Touch ID / Face ID no browser"}
        </p>
      </div>
      <button
        onClick={toggle}
        className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"}`}
      >
        <div className={`absolute top-1 left-1 w-5 h-5 bg-white rounded-full transition-transform ${enabled ? "translate-x-5" : "translate-x-0"}`} />
      </button>
    </div>
  );
};
const SettingsPanel = ({ isDarkMode, onLogout, onChangePin, onReset }) => {
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const clear = () => {
    setOldPin("");
    setNewPin("");
    setNewPin2("");
  };

  const submit = async () => {
    setMsg("");
    setErr("");

    if (!oldPin || !newPin || !newPin2) {
      setErr("Preenche todos os campos.");
      return;
    }
    if (newPin !== newPin2) {
      setErr("O novo PIN e a confirmação não coincidem.");
      return;
    }
    if (newPin.length < 4) {
      setErr("Escolhe um PIN com pelo menos 4 dígitos.");
      return;
    }

    setLoading(true);
    try {
      await onChangePin(oldPin, newPin);
      setMsg("PIN alterado com sucesso.");
      clear();
    } catch (e) {
      setErr(e?.message || "Falha ao alterar PIN.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    return () => clear();
  }, []);

  return (
    <div
      className={`border rounded-[2rem] p-6 lg:p-8 pb-40 lg:pb-32 transition-colors ${isDarkMode ? "bg-[#111114] border-slate-800/60" : "bg-white border-slate-200"
        }`}
    >
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h3 className={`text-xl font-black ${isDarkMode ? "text-white" : "text-slate-900"}`}>Definições</h3>
          <p className={`text-sm mt-1 ${isDarkMode ? "text-slate-500" : "text-slate-500"}`}>Gerir segurança e sessão.</p>
        </div>
        <button
          onClick={onLogout}
          className="px-4 py-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 font-bold text-sm transition-colors"
        >
          Logout
        </button>
      </div>

      <div
        className={`rounded-[1.5rem] border p-5 lg:p-6 transition-colors ${isDarkMode ? "bg-slate-900/20 border-slate-800" : "bg-white border-slate-200"
          }`}
      >
        <h4 className={`font-extrabold mb-1 ${isDarkMode ? "text-white" : "text-slate-900"}`}>Mudar PIN</h4>
        <p className={`text-sm mb-5 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}>
          Isto re-encripta o cofre com um novo PIN.
        </p>

        <SettingsBiometricToggle isDarkMode={isDarkMode} />

        <div className="space-y-4">
          <input
            className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
              }`}
            placeholder="PIN atual"
            type="password"
            value={oldPin}
            onChange={(e) => setOldPin(e.target.value)}
            autoComplete="current-password"
            inputMode="numeric"
          />
          <input
            className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
              }`}
            placeholder="Novo PIN"
            type="password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            autoComplete="new-password"
            inputMode="numeric"
          />
          <input
            className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
              }`}
            placeholder="Confirmar novo PIN"
            type="password"
            value={newPin2}
            onChange={(e) => setNewPin2(e.target.value)}
            autoComplete="new-password"
            inputMode="numeric"
          />

          {err && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl text-xs font-bold text-center">
              {err}
            </div>
          )}
          {msg && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-2xl text-xs font-bold text-center">
              {msg}
            </div>
          )}

          <button
            onClick={submit}
            disabled={loading}
            className="w-full bg-indigo-600 hover:indigo-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "A guardar..." : "Alterar PIN"}
          </button>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="mt-8 rounded-[1.5rem] border border-red-200 dark:border-red-900/30 p-5 lg:p-6 bg-red-50/50 dark:bg-red-900/5">
        <h4 className="font-extrabold mb-1 text-red-600 dark:text-red-400">Zona de Perigo</h4>
        <p className="text-sm mb-5 text-red-500/80 dark:text-red-400/70">
          Ações irreversíveis que apagam os teus dados.
        </p>
        <button
          onClick={onReset}
          className="w-full bg-white dark:bg-red-900/20 border-2 border-red-100 dark:border-red-900/50 text-red-500 dark:text-red-400 font-bold py-4 rounded-2xl hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
        >
          Destruir Cofre Permanentemente
        </button>
      </div>
    </div>
  );
};

/* ------------------------------ Main App ------------------------------ */
const MainApp = ({ isDarkMode, setIsDarkMode, onLogout, user, onConnect, onReset }) => {
  // Use Context
  const { vaultHandle, lock } = useSecurity();

  const [activeTab, setActiveTab] = useState("todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mode] = useState(getModeFromUrl);
  const [confirmModal, setConfirmModal] = useState(null);

  const isWebMode = mode === "web" || mode === "emergency";

  // Data
  const secureCache = useRef([]); // holds decrypted items in memory only
  const [vaultItems, setVaultItems] = useState([]);

  // Secrets
  const [showPassword, setShowPassword] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState("");

  // Create
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState(null); // Track ID if editing
  const [newItem, setNewItem] = useState({ title: "", user: "", pass: "", type: "password", notes: "" });

  // Sync Status State - depends on Firebase user AND internet
  const [lastSync, setLastSync] = useState(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState(""); // New: track sync errors

  // Derive syncStatus from user, network, and syncing state
  const syncStatus = isSyncing ? "syncing" : (!user ? "offline" : (navigator.onLine ? "online" : "offline"));

  const revealTimerRef = useRef(null);
  const clipboardTimerRef = useRef(null);

  // Sync Dark Mode with DOM
  useEffect(() => {
    if (isDarkMode) document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  }, [isDarkMode]);

  const refreshItems = () => {
    try {
      if (!vaultHandle) return;
      const items = vaultHandle.list_entries_metadata(); // ✅ Metadata ONLY (Safe)
      secureCache.current = []; // Clear old cache

      setVaultItems(
        items.map((i) => {
          const updatedAt = new Date(i.updated_at);
          const now = new Date();
          const diffDays = Math.ceil(Math.abs(now - updatedAt) / (1000 * 60 * 60 * 24));

          let strength = "Seguro";
          if (diffDays > 90) strength = "Crítico";
          else if ((i.tags?.[0] || "password") === "password" && i.password_len >= 12) strength = "Forte";

          return {
            id: i.id,
            title: i.title,
            type: i.tags && i.tags.length > 0 ? i.tags[0] : "password",
            username: i.username,
            url: i.url,
            updated: updatedAt.toLocaleDateString("pt-PT"),
            strength,
            content: "", // Content is now fetched on-demand
            has_notes: i.has_notes // Flag for UI
          };
        })
      );
    } catch (e) {
      console.error("Failed to list entries", e);
    }
  };

  useEffect(() => {
    refreshItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vaultHandle]);

  // SECURITY: cleanup timers + clipboard best-effort
  useEffect(() => {
    return () => {
      if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
      if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
      writeClipboardSafe("");
      secureCache.current = [];
    };
  }, []);

  const doLogout = () => {
    setSelectedItem(null);
    setShowPassword(false);
    setRevealedPassword("");

    // clear decrypted cache
    secureCache.current = [];

    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);

    // best-effort clipboard clear
    writeClipboardSafe("");

    // Lock via context or parent prop
    lock();
    onLogout?.();
  };

  const scheduleAutoHide = () => {
    if (revealTimerRef.current) clearTimeout(revealTimerRef.current);
    revealTimerRef.current = setTimeout(() => {
      setShowPassword(false);
      setRevealedPassword("");
    }, 10000);
  };

  // SECURITY: disable clipboard copy/reveal in web/emergency modes
  const handleCopy = async (text) => {
    if (!text) return;
    if (isWebMode) {
      alert("Cópia desativada em Modo Web/Emergência.");
      return;
    }

    await writeClipboardSafe(text);
    if (clipboardTimerRef.current) clearTimeout(clipboardTimerRef.current);
    clipboardTimerRef.current = setTimeout(() => {
      writeClipboardSafe("");
    }, 20000);
  };

  const closeDetails = () => {
    setSelectedItem(null);
    setShowPassword(false);
    setRevealedPassword("");
  };

  const revealSecret = (id) => {
    if (isWebMode) {
      alert("Revelar segredos está desativado em Modo Web/Emergência.");
      return;
    }

    // Fetch from WASM on demand
    try {
      const secretBytes = vaultHandle.get_entry_password(id);
      const noteBytes = vaultHandle.get_entry_notes(id);
      const dec = new TextDecoder();

      if (secretBytes) {
        setRevealedPassword(dec.decode(secretBytes));
        setShowPassword(true);
        scheduleAutoHide();
      }

      // Also reveal notes if they exist
      if (noteBytes) {
        const notesText = dec.decode(noteBytes);
        setSelectedItem(prev => ({ ...prev, content: notesText }));
      }
    } catch (e) {
      console.error("Failed to fetch secret", e);
    }
  };

  const persistExport = async () => {
    // We only persist if it's the main blob.
    setIsSyncing(true);
    setSyncError(""); // Reset error on new attempt
    try {
      const blob = vaultHandle.export();
      await storage.set("richiesafe_vault_blob", JSON.stringify(Array.from(blob)));

      // SYNC: Bump & Push
      bumpLocalMeta();
      await pushLocal("richiesafe_vault_blob");

      setLastSync(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) {
      console.error("Auto-save failed", e);
      // If it's a sync error (propagated from pushLocal), show it.
      // If it's a local storage error, also show it.
      setSyncError("Erro a sincronizar");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleAddNew = async () => {
    try {
      if (!newItem.title) {
        alert("O Título é obrigatório.");
        return;
      }
      // SECURITY: limit huge image base64 to reduce DoS / memory pressure
      if (newItem.type === "image" && newItem.pass && String(newItem.pass).length > 4_000_000) {
        alert("Imagem demasiado grande. Usa um ficheiro mais pequeno.");
        return;
      }

      // Map “notes” into last fields if your core supports it; else keep empty.
      const url = "";
      const notes = newItem.notes || "";

      const newId = vaultHandle.add_entry(newItem.type, newItem.title, newItem.user, newItem.pass, url, notes);

      // If editing, delete old first (Strategy: Create New -> if ok -> Delete Old? Or Delete -> Create?)
      // Since we don't have atomic update, we'll try: Add New -> (if success) -> Delete Old.

      if (editingId) {
        try {
          vaultHandle.delete_entry(editingId);
        } catch (delErr) {
          console.error("Failed to delete old entry during edit", delErr);
          // Not fatal
        }
      }

      // Update UI immediately (Optimistic)
      refreshItems();

      setIsCreating(false);
      setEditingId(null);
      setNewItem({ title: "", user: "", pass: "", type: "password", notes: "" });
      writeClipboardSafe("");

      // Persist in background (but await to catch errors if needed, though UI is already closed)
      await persistExport();
    } catch (e) {
      alert("Erro ao guardar: " + e);
      console.error(e);
    }
  };

  const handleDelete = (id) => {
    setConfirmModal({
      title: "Eliminar Item",
      message: "Tens a certeza que queres eliminar este item?",
      onConfirm: async () => {
        try {
          vaultHandle.delete_entry(id);
          refreshItems();
          closeDetails();
          await persistExport();
        } catch (e) {
          console.error(e);
          alert("Erro ao eliminar: " + e);
        }
      }
    });
  };

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return vaultItems.filter((item) => {
      const matchesSearch = (item.title || "").toLowerCase().includes(q);
      if (activeTab === "todos") return matchesSearch;
      return matchesSearch && item.type === activeTab;
    });
  }, [vaultItems, activeTab, searchQuery]);

  return (
    <div
      className={`flex h-screen w-full transition-colors duration-300 ${isDarkMode ? "dark bg-[#0a0a0c] text-slate-200" : "bg-white text-slate-800"
        }`}
    >
      <ConfirmModal
        open={!!confirmModal}
        title={confirmModal?.title}
        message={confirmModal?.message}
        onConfirm={() => { setConfirmModal(null); confirmModal?.onConfirm(); }}
        onCancel={() => setConfirmModal(null)}
        isDarkMode={isDarkMode}
      />

      {/* Backdrop for Mobile Sidebar */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[45] lg:hidden animate-in fade-in duration-300"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 lg:relative lg:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } border-r flex flex-col transition-transform duration-300 ${isDarkMode ? "bg-[#0d0d10] border-slate-800/50" : "bg-white border-slate-200/50"
          }`}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20 shrink-0">
              <LogoEscudo className="text-white" size={24} />
            </div>
            <h1 className="text-xl font-extrabold text-black dark:text-white tracking-tight">RichieSafe</h1>
          </div>
          <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-slate-500">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-1">
          <NavItem icon={<Lock size={18} />} label="Todos os Itens" active={activeTab === "todos"} onClick={() => { setActiveTab("todos"); setIsSidebarOpen(false); }} />
          <NavItem icon={<Key size={18} />} label="Palavras-passe" active={activeTab === "password"} onClick={() => { setActiveTab("password"); setIsSidebarOpen(false); }} />
          <NavItem icon={<ImageIcon size={18} />} label="Imagens" active={activeTab === "image"} onClick={() => { setActiveTab("image"); setIsSidebarOpen(false); }} />
          <NavItem icon={<FileText size={18} />} label="Notas Seguras" active={activeTab === "note"} onClick={() => { setActiveTab("note"); setIsSidebarOpen(false); }} />
          <NavItem icon={<CreditCard size={18} />} label="Cartões" active={activeTab === "card"} onClick={() => { setActiveTab("card"); setIsSidebarOpen(false); }} />

          <div className="pt-8 pb-2 px-4 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Definições</div>
          <NavItem icon={<Settings size={18} />} label="Configuração" active={activeTab === "settings"} onClick={() => { setActiveTab("settings"); setIsSidebarOpen(false); }} />
        </nav>

        <div className="p-6">
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${isDarkMode
              ? "bg-slate-900 hover:bg-slate-800 text-slate-400"
              : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300 shadow-sm"
              }`}
          >
            {isDarkMode ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-indigo-600" />}
            <span>{isDarkMode ? "Modo Claro" : "Modo Escuro"}</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 relative h-full overflow-hidden">
        {/* Header Superior */}
        <header
          className={`h-24 lg:h-24 border-b flex items-center gap-3 px-4 lg:px-8 backdrop-blur-md sticky top-0 z-30 transition-all duration-300 pt-safe ${isDarkMode ? "border-slate-800/50 bg-[#0a0a0c]/80" : "border-slate-100 bg-white/90"
            }`}
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2 -ml-2 text-slate-500 active:scale-90 transition-transform">
              <Menu size={24} />
            </button>
            <div className="relative w-full max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full rounded-2xl py-2 pl-9 pr-4 outline-none text-sm transition-all ${isDarkMode
                  ? "bg-slate-900/50 border border-slate-800 focus:ring-2 focus:ring-indigo-500/50"
                  : "bg-slate-50 border border-slate-200 focus:border-indigo-500 shadow-sm text-slate-700 placeholder:text-slate-400 font-medium"
                  }`}
                placeholder="Pesquisar..."
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <SyncStatusIndicator status={syncStatus} lastSync={lastSync} isDarkMode={isDarkMode} onConnect={onConnect} syncError={syncError} />

            <div className="flex items-center gap-1">
              <button
                onClick={doLogout}
                className="hidden sm:flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 font-bold text-sm transition-colors"
                title="Sair"
              >
                <span>Logout</span>
              </button>

              <button
                onClick={doLogout}
                className="sm:hidden p-2.5 rounded-xl bg-red-50 text-red-500 dark:bg-red-500/10 dark:text-red-400 active:scale-90 transition-transform"
                title="Sair"
              >
                <LogOut size={18} />
              </button>

              <button
                onClick={() => setIsCreating(true)}
                className="p-2.5 lg:px-5 lg:py-2.5 rounded-xl flex items-center gap-2 transition-all shadow-lg active:scale-90 bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/20"
              >
                <Plus size={20} />
                <span className="hidden lg:inline text-sm font-black tracking-wide">ADICIONAR</span>
              </button>
            </div>
          </div>
        </header>

        {/* Zona de Conteúdo */}
        <div className="p-4 lg:p-8 overflow-y-auto flex-1 custom-scrollbar">
          <div className="max-w-5xl mx-auto">
            <div className="mb-8">
              <h2 className="text-2xl lg:text-3xl font-black tracking-tight" style={{ color: isDarkMode ? "#ffffff" : "#000000" }}>
                O Teu Cofre
              </h2>
              <p className="text-slate-500 text-sm mt-1">
                Dados encriptados localmente (Argon2id + XChaCha20-Poly1305).
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {activeTab === "settings" ? (
                <div
                  className="min-h-full transition-all"
                  onClick={() => setActiveTab("todos")}
                >
                  <div onClick={(e) => e.stopPropagation()} className="animate-in fade-in slide-in-from-bottom-5 duration-500">
                    <SettingsPanel
                      isDarkMode={isDarkMode}
                      onLogout={doLogout}
                      onChangePin={async (oldPin, newPin) => {
                        await vaultHandle.change_pin(oldPin, newPin);
                        persistExport();
                      }}
                      onReset={onReset}
                    />
                  </div>
                  {/* Invisible spacer to catch clicks below shorter content */}
                  <div className="h-64 cursor-pointer" />
                </div>
              ) : (
                <>
                  {filteredItems.map((item) => {
                    const isSelected = selectedItem?.id === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => {
                          setSelectedItem(item);
                          setShowPassword(false);
                          setRevealedPassword("");
                        }}
                        className={`group border p-4 rounded-3xl flex items-center justify-between cursor-pointer transition-all duration-300 ease-out active:scale-[0.97] ${isSelected
                          ? "ring-4 ring-indigo-500/20 shadow-[0_0_30px_rgba(79,70,229,0.15)] border-indigo-500/50 scale-[1.01]"
                          : "hover:ring-4 hover:ring-indigo-500/20 hover:shadow-[0_0_30px_rgba(79,70,229,0.15)] hover:border-indigo-500/50 hover:scale-[1.01]"
                          } ${isDarkMode ? "bg-[#111114] border-slate-800/60" : "bg-white border-transparent shadow-[0_4px_24px_-4px_rgba(0,0,0,0.06)]"
                          }`}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div
                            className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center ${item.type === "password"
                              ? "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600"
                              : item.type === "image"
                                ? "bg-purple-50 dark:bg-purple-500/10 text-purple-600"
                                : item.type === "card"
                                  ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600"
                                  : "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600"
                              }`}
                          >
                            {item.type === "password" ? <Key size={24} /> : item.type === "image" ? <ImageIcon size={24} /> : item.type === "card" ? <CreditCard size={24} /> : <FileText size={24} />}
                          </div>
                          <div className="truncate">
                            <h3 className={`font-bold truncate group-hover:text-indigo-500 transition-colors ${isDarkMode ? "text-white" : "text-slate-900"}`}>
                              {item.title}
                            </h3>
                            <p className="text-xs text-slate-500 truncate">{item.username || "Sem utilizador"}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span
                            className={`hidden sm:inline text-[10px] font-bold px-2 py-1 rounded border uppercase tracking-widest ${item.strength === "Crítico"
                              ? "bg-red-50 dark:bg-red-500/10 text-red-500 border-red-500/20"
                              : item.strength === "Forte"
                                ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                : "bg-blue-50 dark:bg-blue-500/10 text-blue-500 border-blue-500/20"
                              }`}
                          >
                            {item.strength}
                          </span>
                          <ChevronRight className="text-slate-300 dark:text-slate-700" size={20} />
                        </div>
                      </div>
                    );
                  })}

                  {filteredItems.length === 0 && (
                    <div
                      className="text-center py-20 border border-dashed border-slate-200 dark:border-slate-800 rounded-[2rem] transition-colors"
                      style={{ backgroundColor: isDarkMode ? "rgba(15, 23, 42, 0.1)" : "#fafafa" }}
                    >
                      <Search className="mx-auto text-slate-300 mb-4" size={48} />
                      <h3 className="text-lg font-bold text-slate-400">Nada encontrado</h3>
                      <p className="text-slate-400 text-sm">Cofre vazio ou sem resultados.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Nav - Bottom */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0d0d10] border-t border-slate-200 dark:border-slate-800 px-6 pt-3 pb-safe flex justify-between items-center z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
          <MobileNavItem icon={<Lock size={20} />} active={activeTab === "todos"} onClick={() => setActiveTab("todos")} />
          <MobileNavItem icon={<Key size={20} />} active={activeTab === "password"} onClick={() => setActiveTab("password")} />
          <div
            onClick={() => setIsCreating(true)}
            className={`p-4 rounded-full -mt-10 shadow-xl border-4 border-white dark:border-[#0a0a0c] active:scale-90 transition-transform ${isDarkMode ? "bg-indigo-600 text-white shadow-indigo-600/30" : "bg-indigo-600 text-white shadow-indigo-600/30"
              }`}
          >
            <Plus size={24} />
          </div>
          <MobileNavItem icon={<ImageIcon size={20} />} active={activeTab === "image"} onClick={() => setActiveTab("image")} />
          <MobileNavItem icon={<CreditCard size={20} />} active={activeTab === "card"} onClick={() => setActiveTab("card")} />
        </nav>
      </main>

      {/* Modal de Criação */}
      {isCreating && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-300" onClick={() => {
            setIsCreating(false);
            // SECURITY: clear secret draft on cancel
            setNewItem({ title: "", user: "", pass: "", type: "password", notes: "" });
          }}></div>

          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in duration-300" onClick={() => {
            setIsCreating(false);
            setEditingId(null);
            // SECURITY: clear secret draft on cancel
            setNewItem({ title: "", user: "", pass: "", type: "password", notes: "" });
          }}></div>

          <div
            className={`relative p-8 rounded-[2.5rem] w-full max-w-md border shadow-2xl animate-in zoom-in duration-300 max-h-[90vh] overflow-y-auto custom-scrollbar transition-colors ${isDarkMode ? "bg-[#111114] border-slate-800" : "bg-white border-slate-200"
              }`}
          >
            <h2 className="text-2xl font-black mb-6 tracking-tight">{editingId ? "Editar Item" : "Adicionar Novo"}</h2>

            <div className="space-y-4">
              <div
                className={`grid grid-cols-4 gap-2 p-1 rounded-xl mb-4 border transition-colors ${isDarkMode ? "bg-slate-900 border-slate-800" : "bg-slate-100 border-slate-200"
                  }`}
              >
                <button
                  onClick={() => setNewItem({ ...newItem, type: "password", pass: "" })}
                  className={`py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-all ${newItem.type === "password"
                    ? isDarkMode
                      ? "bg-slate-800 text-indigo-400 shadow-sm"
                      : "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500"
                    }`}
                >
                  Password
                </button>
                <button
                  onClick={() => setNewItem({ ...newItem, type: "image", pass: "" })}
                  className={`py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-all ${newItem.type === "image"
                    ? isDarkMode
                      ? "bg-slate-800 text-indigo-400 shadow-sm"
                      : "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500"
                    }`}
                >
                  Imagem
                </button>
                <button
                  onClick={() => setNewItem({ ...newItem, type: "card", pass: "" })}
                  className={`py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-all ${newItem.type === "card"
                    ? isDarkMode
                      ? "bg-slate-800 text-indigo-400 shadow-sm"
                      : "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500"
                    }`}
                >
                  Cartão
                </button>
                <button
                  onClick={() => setNewItem({ ...newItem, type: "note", pass: "" })}
                  className={`py-2 text-[10px] sm:text-xs font-bold rounded-lg transition-all ${newItem.type === "note"
                    ? isDarkMode
                      ? "bg-slate-800 text-indigo-400 shadow-sm"
                      : "bg-white text-indigo-600 shadow-sm"
                    : "text-slate-500"
                    }`}
                >
                  Nota
                </button>
              </div>

              <input
                className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                  }`}
                placeholder="Título (ex: Férias, Cartão Visa...)"
                value={newItem.title}
                onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
              />

              {newItem.type === "card" && (
                <>
                  <input
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    placeholder="Número do Cartão"
                    value={newItem.user}
                    onChange={(e) => setNewItem({ ...newItem, user: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <input
                      className={`flex-1 min-w-0 p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                        }`}
                      placeholder="CVV / PIN"
                      type="password"
                      value={newItem.pass}
                      onChange={(e) => setNewItem({ ...newItem, pass: e.target.value })}
                      autoComplete="off"
                    />
                    <input
                      className={`flex-1 min-w-0 p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                        }`}
                      placeholder="Validade (MM/AA)"
                      value={newItem.notes}
                      onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })}
                      autoComplete="off"
                    />
                  </div>
                </>
              )}

              {newItem.type === "password" && (
                <>
                  <input
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    placeholder="Utilizador / Email"
                    value={newItem.user}
                    onChange={(e) => setNewItem({ ...newItem, user: e.target.value })}
                    autoComplete="username"
                  />
                  <input
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    placeholder="Password"
                    type="password"
                    value={newItem.pass}
                    onChange={(e) => setNewItem({ ...newItem, pass: e.target.value })}
                    autoComplete="new-password"
                  />
                </>
              )}

              {newItem.type === "image" && (
                <div className="space-y-3">
                  <input
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-base transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    placeholder="Nome do Ficheiro / Utilizador"
                    value={newItem.user}
                    onChange={(e) => setNewItem({ ...newItem, user: e.target.value })}
                  />

                  <div
                    className="w-full h-32 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 transition-colors relative"
                    style={{ backgroundColor: isDarkMode ? "rgba(15, 23, 42, 0.3)" : "#fafafa" }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      const file = e.dataTransfer.files?.[0];
                      if (!file) return;
                      if (file.size > 3_000_000) {
                        alert("Imagem demasiado grande (máx ~3MB).");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onloadend = () => setNewItem({ ...newItem, pass: reader.result });
                      reader.readAsDataURL(file);
                    }}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 3_000_000) {
                          alert("Imagem demasiado grande (máx ~3MB).");
                          return;
                        }
                        const reader = new FileReader();
                        reader.onloadend = () => setNewItem({ ...newItem, pass: reader.result });
                        reader.readAsDataURL(file);
                      }}
                    />
                    {newItem.pass ? (
                      <div className="absolute inset-0 p-2">
                        <img src={newItem.pass} className="w-full h-full object-contain rounded-xl" alt="Preview" />
                      </div>
                    ) : (
                      <>
                        <ImageIcon className="text-slate-400 mb-2" size={24} />
                        <span className="text-xs font-bold text-slate-500">Arrastar ou Clicar</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {newItem.type === "note" && (
                <textarea
                  className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors min-h-[150px] ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                    }`}
                  placeholder="Escreve a tua nota segura aqui..."
                  value={newItem.pass}
                  onChange={(e) => setNewItem({ ...newItem, pass: e.target.value })}
                  spellCheck={false}
                />
              )}

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => {
                    setIsCreating(false);
                    // SECURITY: clear secrets on cancel
                    setNewItem({ title: "", user: "", pass: "", type: "password", notes: "" });
                  }}
                  className="flex-1 py-4 text-slate-500 font-bold hover:bg-slate-50 dark:hover:bg-slate-900 rounded-2xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleAddNew}
                  className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-xl shadow-indigo-600/20 active:scale-95 transition-transform"
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drawer de Detalhes */}
      {selectedItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-end sm:p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300" onClick={closeDetails}></div>
          <div className="relative w-full max-w-lg h-full sm:h-auto sm:max-h-[90vh] !bg-white dark:!bg-[#0d0d10] sm:rounded-[2.5rem] border-l dark:border-slate-800 p-8 lg:p-10 flex flex-col shadow-2xl animate-in slide-in-from-right duration-300">
            <div className="flex justify-between items-start mb-8">
              <div
                className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg ${selectedItem.type === "password" ? "bg-indigo-500/10 text-indigo-500" : "bg-purple-500/10 text-purple-500"
                  }`}
              >
                {selectedItem.type === "password" ? <Key size={32} /> : <ImageIcon size={32} />}
              </div>
              <button onClick={closeDetails} className="p-3 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500 hover:rotate-90 transition-transform">
                <X size={24} />
              </button>
            </div>

            <div className="mb-8">
              <h2 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">{selectedItem.title}</h2>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2 py-1 rounded border border-emerald-500/20 uppercase tracking-widest">
                  Protegido
                </span>
                <span className="text-xs text-slate-400">Local-first • Zero-knowledge</span>
              </div>
            </div>

            <div className="space-y-6 flex-1 overflow-y-auto pr-2 custom-scrollbar">
              <DetailField label="Utilizador / Login" value={selectedItem.username || "Não definido"} copyable onCopy={() => handleCopy(selectedItem.username)} />

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Password / Segredo</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={showPassword ? revealedPassword : "••••••••••••"}
                    readOnly
                    className="w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl py-4 px-5 font-mono text-sm text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-indigo-500/30"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex gap-1">
                    <button
                      onClick={() => (showPassword ? setShowPassword(false) : revealSecret(selectedItem.id))}
                      className="p-2 text-slate-400 hover:text-indigo-500 transition-colors"
                      title={showPassword ? "Esconder" : "Ver"}
                    >
                      {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                    </button>
                    <button
                      onClick={() => {
                        const secret = secureCache.current.find((x) => x.id === selectedItem.id)?.password;
                        handleCopy(secret);
                      }}
                      className="p-2 text-slate-400 hover:text-indigo-500 transition-colors"
                      title="Copiar"
                    >
                      <Copy size={20} />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock size={12} className="text-slate-400" />
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">Limpeza automática em 10s</p>
                </div>
              </div>

              {selectedItem.url && <DetailField label="Página Web" value={selectedItem.url} isLink />}
              {selectedItem.content && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Nota Protegida</label>
                  <div className="bg-slate-50 dark:bg-slate-900 rounded-2xl p-5 text-sm text-slate-600 dark:text-slate-300 min-h-[120px] border border-slate-200 dark:border-slate-800">
                    {selectedItem.content}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-8 pt-8 border-t dark:border-slate-800 grid grid-cols-2 gap-4">
              <button
                onClick={() => {
                  // Fetch data on-demand for editing
                  try {
                    const passBytes = vaultHandle.get_entry_password(selectedItem.id);
                    const noteBytes = vaultHandle.get_entry_notes(selectedItem.id);
                    const dec = new TextDecoder();

                    setNewItem({
                      type: selectedItem.type,
                      title: selectedItem.title,
                      user: selectedItem.username || "",
                      pass: passBytes ? dec.decode(passBytes) : "",
                      notes: noteBytes ? dec.decode(noteBytes) : ""
                    });
                    setEditingId(selectedItem.id);
                    setIsCreating(true);
                    closeDetails();
                  } catch (e) {
                    console.error("Edit fetch failed", e);
                    alert("Erro ao carregar dados para edição.");
                  }
                }}
                className={`py-4 rounded-xl font-bold text-sm transition-colors border ${isDarkMode ? "bg-slate-900 hover:bg-slate-800 border-slate-700" : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700 shadow-sm"
                  }`}>
                Editar
              </button>
              <button onClick={() => handleDelete(selectedItem.id)} className="py-4 bg-red-500/10 text-red-500 hover:bg-red-500/20 rounded-2xl font-bold text-sm border border-red-500/20 transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* --- Sync Status Indicator --- */
const SyncStatusIndicator = ({ status, lastSync, isDarkMode, onConnect, syncError }) => {
  // status: 'online' | 'syncing' | 'offline'

  // ERROR STATE
  if (syncError) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${isDarkMode ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-red-50 border-red-200 text-red-600"
        }`}
        title={syncError}
      >
        <div className="relative w-4 h-4 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div className="flex-col leading-none hidden sm:flex">
          <span className="text-[10px] font-bold uppercase tracking-wider">Erro Sync</span>
        </div>
      </div>
    );
  }

  if (status === 'syncing') {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${isDarkMode ? "bg-blue-500/10 border-blue-500/20 text-blue-400" : "bg-blue-50 border-blue-200 text-blue-600"
        }`}>
        <div className="relative w-4 h-4">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        </div>
        <div className="flex-col leading-none hidden sm:flex">
          <span className="text-[10px] font-bold uppercase tracking-wider">A Sincronizar...</span>
        </div>
      </div>
    );
  }

  if (status === 'offline') {
    return (
      <button
        onClick={onConnect}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all hover:scale-105 cursor-pointer ${isDarkMode ? "bg-slate-800 border-slate-700 text-slate-400 hover:border-indigo-500 hover:text-indigo-400" : "bg-slate-100 border-slate-200 text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
          }`}
      >
        <div className="relative w-4 h-4 flex items-center justify-center">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider hidden sm:block">Conectar</span>
      </button>
    );
  }

  // Online (Default)
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${isDarkMode ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-green-50 border-green-200 text-green-700"
      }`}>
      <div className="relative w-4 h-4">
        <svg className="w-4 h-4 backup-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="signal-ring w-full h-full border border-green-400 rounded-full opacity-0"></div>
        </div>
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[10px] font-bold uppercase tracking-wider">Online</span>
        {lastSync && <span className="text-[8px] opacity-70">Sync: {lastSync}</span>}
      </div>
    </div>
  );
};

/* --- UI atoms --- */
const NavItem = ({ icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-sm font-semibold transition-all group ${active
      ? "bg-indigo-600 text-white shadow-xl shadow-indigo-600/30 scale-[1.02]"
      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900/80 hover:text-indigo-600 dark:hover:text-white"
      }`}
  >
    <span className={`${active ? "text-white" : "text-slate-400 group-hover:text-indigo-500"} transition-colors`}>{icon}</span>
    <span>{label}</span>
  </button>
);

const MobileNavItem = ({ icon, active, onClick }) => (
  <button onClick={onClick} className={`p-3 transition-all ${active ? "text-indigo-600 scale-125" : "text-slate-400 hover:text-slate-600"}`}>
    {icon}
  </button>
);

const DetailField = ({ label, value, copyable, onCopy, isLink }) => {
  const onOpen = () => {
    if (!isLink) return;
    const u = safeUrl(value);
    if (u) window.open(u, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="relative group">
        <div
          onClick={onOpen}
          className={`w-full bg-white dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-2xl py-4 px-5 text-sm font-medium ${isLink ? "text-indigo-500 cursor-pointer flex items-center justify-between" : "text-slate-900 dark:text-white"
            }`}
        >
          {value}
          {isLink && <ExternalLink size={14} />}
        </div>
        {copyable && (
          <button onClick={onCopy} className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-all">
            <Copy size={18} />
          </button>
        )}
      </div>
    </div>
  );
};

/* ------------------------------ Recovery PIN Reset Modal ------------------------------ */
const RecoveryPinResetModal = ({ open, onReset, isDarkMode, recoveryKey }) => {
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    setErr("");
    if (newPin.length < 4) {
      setErr("O PIN deve ter pelo menos 4 dígitos.");
      return;
    }
    if (newPin !== newPin2) {
      setErr("Os PINs não coincidem.");
      return;
    }

    setLoading(true);
    try {
      await onReset(recoveryKey, newPin);
    } catch (e) {
      setErr(e.message || "Falha ao mudar PIN");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
      <div className={`w-full max-w-sm rounded-[2.5rem] p-8 lg:p-10 shadow-2xl border transition-all ${isDarkMode ? "bg-[#111114] border-slate-800" : "bg-white border-slate-100"}`}>
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 bg-indigo-600/10 rounded-full flex items-center justify-center mb-6">
            <ShieldCheck className="text-indigo-600" size={32} />
          </div>
          <h2 className={`text-xl font-black mb-2 text-center ${isDarkMode ? "text-white" : "text-slate-900"}`}>Novo PIN Necessário</h2>
          <p className="text-slate-500 text-center mb-8 text-sm px-4">Recuperaste o cofre com sucesso. Define agora um novo PIN para acesso rápido.</p>

          <div className="w-full space-y-4">
            <input
              type="password"
              inputMode="numeric"
              placeholder="Novo PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
              className={`w-full rounded-2xl px-5 py-4 outline-none text-center text-lg font-black tracking-widest transition-all ${isDarkMode ? "bg-slate-900 border-slate-800 text-white focus:ring-2 focus:ring-indigo-500" : "bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500"}`}
            />
            <input
              type="password"
              inputMode="numeric"
              placeholder="Confirmar PIN"
              value={newPin2}
              onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ""))}
              className={`w-full rounded-2xl px-5 py-4 outline-none text-center text-lg font-black tracking-widest transition-all ${isDarkMode ? "bg-slate-900 border-slate-800 text-white focus:ring-2 focus:ring-indigo-500" : "bg-slate-50 border-slate-200 focus:ring-2 focus:ring-indigo-500"}`}
            />
            {err && <div className="text-red-500 text-[10px] font-bold text-center animate-shake">{err}</div>}

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-600/20 active:scale-[0.95] disabled:opacity-50"
            >
              {loading ? "A Guardar..." : "Confirmar Novo PIN"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------ Locked Screen ------------------------------ */
const LockedScreen = ({ onRetry, error, isDarkMode }) => {
  return (
    <div className={`min-h-screen flex items-center justify-center p-6 transition-colors duration-300 ${isDarkMode ? "bg-[#0a0a0c]" : "bg-white"}`}>
      <div className={`w-full max-w-sm rounded-[2.5rem] p-8 lg:p-10 relative overflow-hidden transition-all duration-300 ${isDarkMode
        ? "bg-[#111114] shadow-2xl border border-slate-800"
        : "bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] border border-slate-100"
        }`}>
        <div className="absolute top-0 left-0 w-full h-2 bg-red-500"></div>

        <div className="flex flex-col items-center justify-center py-6 animate-in fade-in zoom-in duration-300">
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Lock className="text-red-500" size={40} />
          </div>
          <h2 className={`text-xl font-black mb-2 text-center ${isDarkMode ? "text-white" : "text-slate-900"}`}>
            RichieSafe Bloqueado
          </h2>
          <p className="text-slate-500 text-center mb-8 px-4 text-sm font-medium">
            Confirma a tua biometria para aceder aos teus dados.
          </p>

          {error && (
            <div className="w-full p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl text-[10px] font-bold text-center mb-6 animate-shake">
              {error}
            </div>
          )}

          <button
            onClick={onRetry}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.95] flex items-center justify-center gap-2"
          >
            <ShieldCheck size={20} />
            <span>Autenticar</span>
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------ App Root ------------------------------ */
const App = () => {
  const {
    isReady,
    vaultHandle,
    unlock,
    create,
    lock,
    error: ctxError,
    isBioAuthenticated,
    setIsBioAuthenticated
  } = useSecurity();

  // Sync / Auth State
  const [user, setUser] = useState(null);

  // Storage Key tracking (default)
  const [vaultStorageKey, setVaultStorageKey] = useState("richiesafe_vault_blob");

  const [confirmModal, setConfirmModal] = useState(null); // { title, message, onConfirm }
  const [bioError, setBioError] = useState("");
  const [needsPinReset, setNeedsPinReset] = useState(false);
  const [tempRecoveryKey, setTempRecoveryKey] = useState("");

  useEffect(() => {
    const unsub = listenAuth(async (u) => {
      setUser(u);
      if (!u) return;

      // Sync logic can remain here or move to a SyncContext
      try {
        const result = await initialSync(vaultStorageKey);
        console.log("Initial Sync Result:", result);

        const unsubMeta = listenRemoteChanges(vaultStorageKey, (blob) => {
          console.log("Remote blob updated via sync.");
        });
        window.__richiesafe_unsubMeta = unsubMeta;
      } catch (e) {
        console.error("Sync init failed", e);
      }
    });

    return () => {
      try {
        unsub?.();
        if (window.__richiesafe_unsubMeta) window.__richiesafe_unsubMeta();
      } catch { }
    };
  }, []);

  // Sync Dark Mode
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem("richiesafe_theme");
    return saved ? saved === "dark" : true;
  });

  useEffect(() => {
    localStorage.setItem("richiesafe_theme", isDarkMode ? "dark" : "light");
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
      StatusBar.setStyle({ style: Style.Dark }).catch(() => { });
      StatusBar.setBackgroundColor({ color: "#0a0a0c" }).catch(() => { });
    } else {
      document.documentElement.classList.remove("dark");
      StatusBar.setStyle({ style: Style.Light }).catch(() => { });
      StatusBar.setBackgroundColor({ color: "#ffffff" }).catch(() => { });
    }
  }, [isDarkMode]);

  // Debug state transitions
  useEffect(() => {
    console.log("App State Change: vaultHandle:", !!vaultHandle, "isBioAuthenticated:", isBioAuthenticated);
  }, [vaultHandle, isBioAuthenticated]);

  // Background Listener for Auto-Lock
  useEffect(() => {
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        // Lock on background
        lock();
      }
    });
    return () => { sub.then(h => h.remove()).catch(() => { }); };
  }, [lock]);

  // App Level Strict Lock
  const bioEnabled = localStorage.getItem("richiesafe_bio_enabled") === "true";

  const handleReset = (setModalInfo) => {
    setModalInfo({
      title: "⚠️ Destruir Cofre",
      message: "ATENÇÃO: Isto vai APAGAR PERMANENTEMENTE o cofre guardado neste browser e na NUVEM.\n\nEsta ação é irreversível.\n\nQueres continuar?",
      onConfirm: async () => {
        // 1. Clear local vault data FIRST
        await storage.remove("richiesafe_vault_blob");
        await storage.remove("richiesafe_vault_decoy");
        localStorage.removeItem("richiesafe_theme");
        localStorage.removeItem("richiesafe_bio_enabled");
        localStorage.removeItem("richiesafe_webauthn_cred");
        localStorage.removeItem("richiesafe_bio_pin");

        // Clear anything else richiesafe related
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.includes("richiesafe")) {
            localStorage.removeItem(key);
          }
        }

        // 2. Delete remote vault from Firebase
        try { await deleteRemoteVault(); } catch (e) { console.warn("Remote delete on reset:", e); }
        // 3. Fully sign out (Firebase + native Google)
        try { await logoutFirebase(); } catch (e) { console.warn("Logout on reset:", e); }

        // 4. Force Nuke IndexedDB just in case
        await nukeFirebaseData();

        // 5. Reload to clear everything
        setTimeout(() => window.location.reload(), 500);
      }
    });
  };

  const handleLogout = async () => {
    lock();
    await logoutFirebase();
  };

  const handleRecoveryPinReset = async (oldKey, newPin) => {
    try {
      await vaultHandle.change_pin(oldKey, newPin);

      // Update Biometrics too if enabled
      if (localStorage.getItem("richiesafe_bio_enabled") === "true") {
        try {
          if (isNativeApp) {
            await NativeBiometric.setCredentials({
              username: "user",
              password: newPin,
              server: "richiesafe.app",
            });
          } else {
            await webAuthnBiometrics.register(newPin);
          }
        } catch (e) {
          console.warn("Failed to update bio credentials after recovery reset", e);
        }
      }

      // Persist Export Inline (Fix ReferenceError)
      const blob = vaultHandle.export();
      await storage.set("richiesafe_vault_blob", JSON.stringify(Array.from(blob)));

      // SYNC: Bump & Push
      try {
        bumpLocalMeta();
        await pushLocal("richiesafe_vault_blob");
      } catch (syncErr) {
        console.warn("Sync push failed after reset:", syncErr);
      }

      setNeedsPinReset(false);
      setTempRecoveryKey("");
      alert("PIN alterado com sucesso!");
    } catch (e) {
      throw e;
    }
  };

  // Main Render Logic
  let content;
  if (!isReady) {
    content = (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0c] text-white p-8 text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-6 animate-bounce shadow-2xl shadow-indigo-600/40">
          <LogoEscudo size={32} />
        </div>
        <p className="font-bold tracking-widest text-sm animate-pulse mb-4">A CARREGAR SEGURANÇA...</p>
        {ctxError && <div className="text-red-500 text-xs">{ctxError}</div>}
      </div>
    );
  } else if (vaultHandle && bioEnabled && !isBioAuthenticated) {
    content = (
      <LockedScreen
        isDarkMode={isDarkMode}
        error={bioError}
        onRetry={async () => {
          setBioError("");
          console.log("LockedScreen: onRetry clicked");
          try {
            const result = await NativeBiometric.verifyIdentity({
              reason: "Segurança Adicional",
              title: "RichieSafe Bloqueado",
              subtitle: "Confirma a tua identidade",
              description: "Acesso ao cofre requer biometria.",
            });
            console.log("LockedScreen: verifyIdentity returned:", JSON.stringify(result));
            console.log("LockedScreen: Verification success. Setting isBioAuthenticated to TRUE");
            setIsBioAuthenticated(true);
          } catch (e) {
            console.warn("Bio retry failed", e);
            const msg = e.message || String(e);
            if (msg.toLowerCase().includes("cancel") || msg.toLowerCase().includes("user")) {
              setBioError("Autenticação cancelada.");
            } else {
              setBioError(`Erro: ${msg}`);
            }
          }
        }}
      />
    );
  } else if (!vaultHandle) {
    content = (
      <AuthScreen
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        user={user}
        onReset={() => handleReset(setConfirmModal)}
        setNeedsPinReset={setNeedsPinReset}
        setTempRecoveryKey={setTempRecoveryKey}
      />
    );
  } else {
    content = (
      <MainApp
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        onLogout={handleLogout}
        user={user}
        onConnect={() => window.location.reload()}
        onReset={() => handleReset(setConfirmModal)}
      />
    );
  }

  return (
    <>
      <ConfirmModal
        open={!!confirmModal}
        title={confirmModal?.title}
        message={confirmModal?.message}
        onConfirm={() => { setConfirmModal(null); confirmModal?.onConfirm(); }}
        onCancel={() => setConfirmModal(null)}
        isDarkMode={isDarkMode}
      />
      <RecoveryPinResetModal
        open={needsPinReset}
        recoveryKey={tempRecoveryKey}
        isDarkMode={isDarkMode}
        onReset={handleRecoveryPinReset}
      />
      {content}
    </>
  );
};

export default App;
