import { registerRootComponent } from "expo";
// Defines the background alert task before anything else runs.
import "./src/background.ts";
import { App } from "./src/App";

registerRootComponent(App);
