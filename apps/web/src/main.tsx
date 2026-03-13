import { render } from "preact";
import { App } from "./app.js";
import { applyTheme, getTheme } from "./lib/theme.js";
import "./styles/global.css";

applyTheme(getTheme());
render(<App />, document.getElementById("app")!);
