import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const stored = localStorage.getItem("ecc.theme");
document.documentElement.dataset.theme = stored === "light" ? "light" : "dark";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
