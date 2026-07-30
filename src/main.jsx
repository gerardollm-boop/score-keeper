import "./storage-polyfill";
import React from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import ScoreKeeper from "./ScoreKeeper";
createRoot(document.getElementById("root")).render(<ScoreKeeper />);
