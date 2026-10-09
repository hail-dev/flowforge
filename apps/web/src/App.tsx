import { useState } from "react";
import { getToken, clearToken } from "./api";
import Login from "./Login";
import Canvas from "./Canvas";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);
  return loggedIn ? (
    <Canvas onLogout={() => { clearToken(); setLoggedIn(false); }} />
  ) : (
    <Login onSuccess={() => setLoggedIn(true)} />
  );
}