import { useState } from "react";
import { getToken } from "./api";
import Login from "./Login";
import Canvas from "./Canvas";

export default function App() {
    const [loggedIn, setLoggedIn] = useState(() => getToken() !== null);
    return loggedIn ? <Canvas /> : <Login onSuccess={() => setLoggedIn(true)} />;
}