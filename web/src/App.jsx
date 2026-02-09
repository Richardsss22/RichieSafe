import React, { useState, useEffect, useMemo, useRef } from "react";

// import { generate_mnemonic } from "./pkg/richiesafe_wasm";
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
  ChevronRight,
  Image as ImageIcon,
} from "lucide-react";
import { listenAuth, logoutFirebase, loginEmail, registerEmail, loginGoogle } from "./auth";
import { auth } from "./firebase";
import { initialSync, listenRemoteChanges, pushLocal, bumpLocalMeta } from "./sync";
import { useSecurity } from "./context/SecurityContext";


/* ------------------------------ Helpers ------------------------------ */
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

/* ------------------------------ Auth Screen ------------------------------ */
const AuthScreen = ({ isDarkMode, setIsDarkMode, user }) => {
  const { unlock, create, isReady } = useSecurity();
  const [hasVault, setHasVault] = useState(false);

  // ---- Sessão (Firebase Auth) - opcional ----
  const [authMode, setAuthMode] = useState("login"); // "login" | "register"
  const [email, setEmail] = useState("");
  const [authPass, setAuthPass] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authMsg, setAuthMsg] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [showCloudSync, setShowCloudSync] = useState(false); // Collapsible Cloud Sync section

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
      setAuthErr("Falha na autenticação. Verifica credenciais.");
      console.error(e);
    } finally {
      setAuthLoading(false);
    }
  };

  const doGoogle = async () => {
    setAuthErr("");
    setAuthMsg("");
    setAuthLoading(true);
    try {
      await loginGoogle();
      setAuthMsg("Sessão iniciada com Google.");
    } catch (e) {
      setAuthErr("Falha no login Google.");
      console.error(e);
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
        const verified = await NativeBiometric.verifyIdentity({
          reason: "Desbloquear cofre RichieSafe",
          title: "Desbloquear Cofre",
          subtitle: "Usa a tua impressão digital ou face",
          description: "Confirma a tua identidade para aceder ao cofre.",
        }).catch(() => null);

        if (verified) {
          const creds = await NativeBiometric.getCredentials({
            server: "richiesafe.app",
          }).catch(() => null);

          if (creds && creds.password) {
            localStorage.setItem("richiesafe_bio_enabled", "true");
            setPin(creds.password);

            // Trigger unlock naturally via Context
            const realBlobJson = await storage.get("richiesafe_vault_blob");
            if (realBlobJson) {
              const realBlob = new Uint8Array(JSON.parse(realBlobJson));
              await unlock(realBlob, creds.password);
            }
          }
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
      // const phrase = generate_mnemonic(); // Still using direct import for util, or WASM export
      const phrase = "recovery_phrase_placeholder"; // DEBUG: Temporary placeholder
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

      const shouldBeEnabled = localStorage.getItem("richiesafe_bio_enabled") === "true";

      if (shouldBeEnabled) {
        // Enforce STRICT check. If we can't get credentials (cancelled/failed), WE BLOCK.
        const bioCreds = await NativeBiometric.getCredentials({ server: "richiesafe.app" }).catch(() => null);

        if (!bioCreds) {
          throw new Error("Biometria obrigatória! (Cancelaste ou falhou?)");
        }

        // Double verification (explicit prompt)
        try {
          const verified = await NativeBiometric.verifyIdentity({
            reason: "Verificação de Segurança Dupla",
            title: "Segurança Máxima",
            subtitle: "Confirma biometria",
            description: "Modo estrito: PIN + Biometria necessários.",
          });
          if (!verified) throw new Error("Biometria não confirmada.");
        } catch (e) {
          throw new Error("Falha na confirmação biométrica.");
        }
      }

      clearSensitiveInputs();
    } catch (e) {
      setError(String(e).includes("Biometria") ? String(e.message) : "PIN incorreto.");
      console.error(e);
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

      clearSensitiveInputs();
    } catch (e) {
      setError("Chave de recuperação inválida ou erro.");
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    const ok = window.confirm(
      "ATENÇÃO: Isto vai APAGAR PERMANENTEMENTE o cofre guardado neste browser.\n\n" +
      "Queres continuar?"
    );
    if (!ok) return;

    storage.remove("richiesafe_vault_blob");
    storage.remove("richiesafe_vault_decoy");
    localStorage.removeItem("richiesafe_theme");

    clearSensitiveInputs();
    window.location.reload();
  };

  useEffect(() => {
    return () => {
      clearSensitiveInputs();
    };
  }, []);

  return (
    <div
      className={`min-h-screen flex items-center justify-center p-4 transition-colors duration-300 ${isDarkMode ? "bg-[#0a0a0c]" : "bg-white"
        }`}
    >
      <div
        className={`w-full max-w-md rounded-[2.5rem] p-8 lg:p-10 relative overflow-hidden transition-all duration-300 ${isDarkMode
          ? "bg-[#111114] shadow-2xl border border-slate-800"
          : "bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] border border-slate-100"
          }`}
      >
        <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>

        {/* NORMAL UI START */}
        <div className="flex justify-between items-start mb-8">
          <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
            <Shield className="text-white" size={32} />
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
          {hasVault ? "Bem-vindo de volta. Insira o seu PIN." : "Crie o seu novo cofre encriptado."}
        </p>

        {/* ---- PIN SECTION (PRIMARY) ---- */}
        <div className="space-y-5">
          {hasVault && isRecovering ? (
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

          {!hasVault && (
            <>
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1 text-red-500">
                  PIN DE PÂNICO
                </label>
                <input
                  type="password"
                  value={panicPin}
                  onChange={(e) => setPanicPin(e.target.value)}
                  className="w-full bg-red-50 dark:bg-red-500/5 border border-red-100 dark:border-red-900/30 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-red-500/50 font-bold transition-all text-red-600 tracking-widest"
                  placeholder="••••••"
                  autoComplete="new-password"
                  inputMode="numeric"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">
                    FRASE DE RECUPERAÇÃO
                  </label>
                  <button
                    type="button"
                    onClick={handleGenerateRecovery}
                    className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 uppercase tracking-widest"
                  >
                    Gerar
                  </button>
                </div>

                <textarea
                  value={recovery}
                  onChange={(e) => setRecovery(e.target.value)}
                  className="w-full border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 outline-none focus:ring-2 focus:ring-indigo-500/50 dark:bg-slate-900/50 dark:text-white min-h-[100px] placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  style={{ backgroundColor: isDarkMode ? "" : "#FAFAFA", color: isDarkMode ? "white" : "black" }}
                  placeholder="Clique em GERAR ou escreva a sua..."
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                />

                <div className="text-[10px] text-slate-400 font-medium uppercase tracking-tighter">
                  Guarda esta frase offline. Não a deixes no clipboard.
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl text-xs font-bold text-center animate-pulse">
              {error}
            </div>
          )}

          {!hasVault && (
            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-5 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50 mt-4"
            >
              {loading ? "A criar..." : "Criar Cofre"}
            </button>
          )}

          {hasVault && (
            <>
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
            </>
          )}
        </div>

        {/* ---- CLOUD SYNC (OPTIONAL - COLLAPSIBLE) ---- */}
        <div className={`mt-8 pt-6 border-t ${isDarkMode ? "border-slate-800" : "border-slate-100"}`}>
          <button
            onClick={() => setShowCloudSync(!showCloudSync)}
            className={`w-full flex items-center justify-between py-3 px-4 rounded-2xl transition-colors ${isDarkMode
              ? "bg-slate-900/30 hover:bg-slate-900/50 text-slate-400"
              : "bg-slate-50 hover:bg-slate-100 text-slate-500"
              }`}
          >
            <span className="text-xs font-bold uppercase tracking-widest">
              ☁️ Cloud Sync (Opcional)
            </span>
            <span className={`text-lg transition-transform ${showCloudSync ? "rotate-180" : ""}`}>
              ▾
            </span>
          </button>

          {showCloudSync && (
            <div className={`mt-4 rounded-[2rem] border p-5 transition-colors ${isDarkMode ? "bg-slate-900/20 border-slate-800" : "bg-white border-slate-200"
              }`}>
              <div className="flex items-center justify-between gap-3 mb-3">
                <div>
                  <p className={`text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-slate-500" : "text-slate-400"
                    }`}>
                    Sessão Firebase
                  </p>
                  <p className={`text-sm font-semibold ${isDarkMode ? "text-white" : "text-slate-900"
                    }`}>
                    {user ? "Ligado" : "Sem sessão"}
                  </p>
                  <p className={`text-xs mt-1 ${isDarkMode ? "text-slate-500" : "text-slate-500"
                    }`}>
                    A sincronização só funciona quando tiveres sessão iniciada.
                  </p>
                </div>

                {user ? (
                  <button
                    onClick={async () => {
                      try { await logoutFirebase(); } catch { }
                    }}
                    className="px-4 py-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 font-bold text-xs transition-colors"
                  >
                    Terminar
                  </button>
                ) : (
                  <button
                    onClick={continueOffline}
                    className={`px-4 py-2 rounded-xl font-bold text-xs transition-colors ${isDarkMode
                      ? "bg-slate-900 hover:bg-slate-800 text-slate-400"
                      : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300 shadow-sm"
                      }`}
                  >
                    Offline
                  </button>
                )}
              </div>

              {!user && (
                <>
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setAuthMode("login")}
                      className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${authMode === "login"
                        ? (isDarkMode ? "bg-slate-800 text-indigo-400" : "bg-slate-100 text-indigo-600")
                        : (isDarkMode ? "text-slate-500 hover:text-white" : "text-slate-500 hover:text-slate-800")
                        }`}
                    >
                      Login
                    </button>
                    <button
                      onClick={() => setAuthMode("register")}
                      className={`flex-1 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${authMode === "register"
                        ? (isDarkMode ? "bg-slate-800 text-indigo-400" : "bg-slate-100 text-indigo-600")
                        : (isDarkMode ? "text-slate-500 hover:text-white" : "text-slate-500 hover:text-slate-800")
                        }`}
                    >
                      Registo
                    </button>
                  </div>

                  <div className="space-y-3">
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={`w-full rounded-2xl px-5 py-3 outline-none text-sm transition-all ${isDarkMode
                        ? "bg-slate-900/50 border border-slate-800 text-white focus:ring-2 focus:ring-indigo-500/50"
                        : "bg-white border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500/30"
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
                        : "bg-white border border-slate-200 text-slate-900 focus:ring-2 focus:ring-indigo-500/30"
                        }`}
                      placeholder="Password"
                      type="password"
                      autoComplete={authMode === "login" ? "current-password" : "new-password"}
                    />

                    {(authErr || authMsg) && (
                      <div className={`p-3 rounded-2xl text-xs font-bold text-center ${authErr
                        ? "bg-red-500/10 border border-red-500/20 text-red-500"
                        : "bg-emerald-500/10 border border-emerald-500/20 text-emerald-500"
                        }`}>
                        {authErr || authMsg}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={doEmailAuth}
                        disabled={authLoading}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
                      >
                        {authLoading ? "A validar..." : (authMode === "login" ? "Entrar" : "Criar Conta")}
                      </button>

                      <button
                        onClick={doGoogle}
                        disabled={authLoading}
                        className={`flex-1 font-bold py-3 rounded-2xl transition-all active:scale-[0.98] disabled:opacity-50 ${isDarkMode
                          ? "bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800"
                          : "bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm"
                          }`}
                        title="Login com Google"
                      >
                        Google
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ---- RESET VAULT (only when vault exists) ---- */}
        {hasVault && (
          <div className="mt-8 pt-6 border-t border-slate-100 dark:border-slate-800 text-center">
            <button
              onClick={handleReset}
              className="text-[10px] font-bold text-red-400 hover:text-red-500 uppercase tracking-widest transition-colors"
            >
              Destruir Cofre (Reset)
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------ Settings Panel ------------------------------ */
const SettingsBiometricToggle = ({ isDarkMode }) => {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Check if previously enabled in this session/device
    const stored = localStorage.getItem("richiesafe_bio_enabled") === "true";
    if (stored) {
      NativeBiometric.getCredentials({ server: "richiesafe.app" })
        .then(creds => setEnabled(!!creds))
        .catch(() => setEnabled(false));
    }
  }, []);

  const toggle = async () => {
    if (enabled) {
      await NativeBiometric.deleteCredentials({ server: "richiesafe.app" });
      localStorage.setItem("richiesafe_bio_enabled", "false"); // Disable flag
      setEnabled(false);
    } else {
      const pin = prompt("Insere o teu PIN atual para ativar biometria:");
      if (!pin) return;

      try {
        await NativeBiometric.setCredentials({
          username: "user",
          password: pin,
          server: "richiesafe.app",
        });
        localStorage.setItem("richiesafe_bio_enabled", "true"); // Enable flag
        setEnabled(true);
        alert("Biometria ativada!");
      } catch (e) {
        alert("Falha ao ativar biometria.");
        localStorage.setItem("richiesafe_bio_enabled", "false");
      }
    }
  };

  return (
    <div className={`mb-6 p-4 rounded-2xl border flex items-center justify-between ${isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-200"}`}>
      <div>
        <h5 className={`font-bold text-sm ${isDarkMode ? "text-white" : "text-slate-900"}`}>Segurança Máxima (2FA)</h5>
        <p className="text-xs text-slate-500">Exige biometria ALÉM do PIN</p>
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
const SettingsPanel = ({ isDarkMode, onLogout, onChangePin }) => {
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
      className={`border rounded-[2rem] p-6 lg:p-8 transition-colors ${isDarkMode ? "bg-[#111114] border-slate-800/60" : "bg-white border-slate-200"
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
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 rounded-2xl shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? "A guardar..." : "Alterar PIN"}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ------------------------------ Main App ------------------------------ */
const MainApp = ({ isDarkMode, setIsDarkMode, onLogout }) => {
  // Use Context
  const { vaultHandle, lock } = useSecurity();

  const [activeTab, setActiveTab] = useState("todos");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [mode] = useState(getModeFromUrl);

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
    // In context-based approach, context handles export/sync usually, 
    // but here we manually save to storage for persistence using context export.
    try {
      const blob = vaultHandle.export();
      await storage.set("richiesafe_vault_blob", JSON.stringify(Array.from(blob)));

      // SYNC: Bump & Push
      bumpLocalMeta();
      await pushLocal("richiesafe_vault_blob");
    } catch (e) {
      console.error("Auto-save failed", e);
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

      await persistExport();
      refreshItems();

      // SECURITY: clear secret inputs immediately
      setIsCreating(false);
      setEditingId(null);
      setNewItem({ title: "", user: "", pass: "", type: "password", notes: "" });
      writeClipboardSafe("");
    } catch (e) {
      alert("Erro ao guardar: " + e);
      console.error(e);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Tens a certeza que queres eliminar este item?")) return;
    try {
      vaultHandle.delete_entry(id);
      await persistExport();
      refreshItems();
      closeDetails();
    } catch (e) {
      console.error(e);
      alert("Erro ao eliminar: " + e);
    }
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
      {/* Sidebar - Desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-72 lg:relative lg:translate-x-0 ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } border-r flex flex-col transition-transform duration-300 ${isDarkMode ? "bg-[#0d0d10] border-slate-800/50" : "bg-white border-slate-200/50"
          }`}
      >
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Shield className="text-white" size={24} />
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
          className={`h-16 lg:h-20 border-b flex items-center gap-4 px-4 lg:px-8 backdrop-blur-md sticky top-0 z-30 transition-colors duration-300 pt-[env(safe-area-inset-top)] ${isDarkMode ? "border-slate-800/50 bg-[#0a0a0c]/80" : "border-slate-100 bg-white/90"
            }`}
        >
          <div className="flex items-center gap-4 flex-1">
            <button onClick={() => setIsSidebarOpen(true)} className="lg:hidden p-2">
              <Menu size={24} />
            </button>
            <div className="relative w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full rounded-xl py-2.5 pl-10 pr-4 outline-none text-sm transition-all ${isDarkMode
                  ? "bg-slate-900/50 border border-slate-800 focus:ring-2 focus:ring-indigo-500/50"
                  : "bg-white border border-slate-200 focus:border-indigo-500 shadow-sm text-slate-700 placeholder:text-slate-400"
                  }`}
                placeholder="Pesquisar no teu cofre..."
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div
              className={`hidden sm:flex items-center gap-2 text-xs font-bold px-3 py-2 rounded-lg border ${isDarkMode ? "bg-slate-900 border-slate-800 text-slate-500" : "bg-white border-slate-200 text-slate-600 shadow-sm"
                }`}
            >
              <ShieldCheck size={14} className="text-emerald-500" />
              <span>Local</span>
            </div>

            <button
              onClick={doLogout}
              className="px-4 py-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20 font-bold text-sm transition-colors"
            >
              Logout
            </button>

            <button
              onClick={() => setIsCreating(true)}
              className={`p-2 lg:px-4 lg:py-2 rounded-xl flex items-center gap-2 transition-all shadow-lg active:scale-95 ${isDarkMode ? "bg-indigo-600 hover:bg-indigo-500 text-white" : "bg-white hover:bg-slate-50 text-indigo-600 border border-indigo-100 shadow-indigo-100"
                }`}
            >
              <Plus size={20} />
              <span className="hidden lg:inline text-sm font-bold">Adicionar</span>
            </button>
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
                <SettingsPanel
                  isDarkMode={isDarkMode}
                  onLogout={doLogout}
                  onChangePin={async (oldPin, newPin) => {
                    await vaultHandle.change_pin(oldPin, newPin);
                    persistExport();
                  }}
                />
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
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-[#0d0d10] border-t border-slate-200 dark:border-slate-800 px-6 py-3 flex justify-between items-center z-40 pb-safe">
          <MobileNavItem icon={<Lock size={20} />} active={activeTab === "todos"} onClick={() => setActiveTab("todos")} />
          <MobileNavItem icon={<Key size={20} />} active={activeTab === "password"} onClick={() => setActiveTab("password")} />
          <div
            onClick={() => setIsCreating(true)}
            className={`p-4 rounded-full -mt-12 shadow-xl border-4 border-slate-50 dark:border-[#0a0a0c] active:scale-90 transition-transform ${isDarkMode ? "bg-indigo-600 text-white" : "bg-white text-indigo-600"
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
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    placeholder="Número do Cartão"
                    value={newItem.user}
                    onChange={(e) => setNewItem({ ...newItem, user: e.target.value })}
                  />
                  <div className="flex gap-2">
                    <input
                      className={`flex-1 min-w-0 p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                        }`}
                      placeholder="CVV / PIN"
                      type="password"
                      value={newItem.pass}
                      onChange={(e) => setNewItem({ ...newItem, pass: e.target.value })}
                      autoComplete="off"
                    />
                    <input
                      className={`flex-1 min-w-0 p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
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
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
                      }`}
                    placeholder="Utilizador / Email"
                    value={newItem.user}
                    onChange={(e) => setNewItem({ ...newItem, user: e.target.value })}
                    autoComplete="username"
                  />
                  <input
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
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
                    className={`w-full p-4 rounded-2xl border outline-none focus:ring-2 focus:ring-indigo-500 text-sm transition-colors ${isDarkMode ? "bg-slate-900/50 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-900"
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
                    const passBytes = handle.get_entry_password(selectedItem.id);
                    const noteBytes = handle.get_entry_notes(selectedItem.id);
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

/* ------------------------------ Locked Screen ------------------------------ */
const LockedScreen = ({ onRetry, isDarkMode }) => {
  return (
    <div className={`min-h-screen flex items-center justify-center p-6 transition-colors duration-300 ${isDarkMode ? "bg-[#0a0a0c]" : "bg-white"}`}>
      <div className={`w-full max-w-md rounded-[2.5rem] p-8 lg:p-10 relative overflow-hidden transition-all duration-300 ${isDarkMode
        ? "bg-[#111114] shadow-2xl border border-slate-800"
        : "bg-white shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] border border-slate-100"
        }`}>
        <div className="absolute top-0 left-0 w-full h-2 bg-red-500"></div>

        <div className="flex flex-col items-center justify-center py-10 animate-in fade-in zoom-in duration-300">
          <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mb-6 animate-pulse">
            <Lock className="text-red-500" size={48} />
          </div>
          <h2 className={`text-2xl font-black mb-2 ${isDarkMode ? "text-white" : "text-slate-900"}`}>
            RichieSafe Bloqueado
          </h2>
          <p className="text-slate-500 text-center mb-8 px-4">
            Autenticação Biométrica Necessária
          </p>

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
  // Use Global Security Context
  const { isReady, vaultHandle, unlock, create, lock, error: ctxError } = useSecurity();

  // Sync / Auth State
  const [user, setUser] = useState(null);

  // Storage Key tracking (default)
  const [vaultStorageKey, setVaultStorageKey] = useState("richiesafe_vault_blob");

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

  if (!isReady) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0a0a0c] text-white p-8 text-center">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mb-6 animate-bounce shadow-2xl shadow-indigo-600/40">
          <Shield size={32} />
        </div>
        <p className="font-bold tracking-widest text-sm animate-pulse mb-4">A CARREGAR SEGURANÇA...</p>
        {ctxError && <div className="text-red-500 text-xs">{ctxError}</div>}
      </div>
    );
  }

  // If locked manually or by biometrics (Context doesn't handle UI lock overlay, just key state)
  // But strictly, if vaultHandle is null, we show AuthScreen.

  if (!vaultHandle) {
    return (
      <AuthScreen
        isDarkMode={isDarkMode}
        setIsDarkMode={setIsDarkMode}
        user={user}
      />
    );
  }

  const handleLogout = async () => {
    lock();
    await logoutFirebase();
  };

  return (
    <MainApp
      isDarkMode={isDarkMode}
      setIsDarkMode={setIsDarkMode}
      onLogout={handleLogout}
    />
  );
};

export default App;
