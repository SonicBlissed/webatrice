import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { ProfileProvider } from "./lib/profile";
import { CardScaleProvider } from "./lib/cardScale";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <ProfileProvider>
        <CardScaleProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </CardScaleProvider>
      </ProfileProvider>
    </AuthProvider>
  </React.StrictMode>,
);
