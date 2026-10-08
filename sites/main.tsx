import React from "react";
import { createRoot } from "react-dom/client";
import { RecyclingCallApp } from "../src/components/recycling/RecyclingCallApp";
import "../src/app/globals.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><RecyclingCallApp /></React.StrictMode>);
