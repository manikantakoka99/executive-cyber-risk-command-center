import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

const stored = localStorage.getItem("ecc.theme");
document.documentElement.dataset.theme = stored === "dark" ? "dark" : "light";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
