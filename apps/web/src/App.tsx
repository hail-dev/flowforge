import { useState } from "react";
import { getToken, clearToken } from "./api";
import Login from "./Login";
import Canvas from "./Canvas";
import History from "./History";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);
  const [view, setView] = useState<"builder" | "history">("builder");

  const logout = () => {
    clearToken();
    setLoggedIn(false);
    setView("builder");
  };

  if (!loggedIn) return <Login onSuccess={() => setLoggedIn(true)} />;
  return view === "history" ? (
    <History onBack={() => setView("builder")} onLogout={logout} />
  ) : (
    <Canvas onLogout={logout} onShowHistory={() => setView("history")} />
  );
}