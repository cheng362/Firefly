import { mount } from "svelte";
import App from "./AdminApp.svelte";
import "./admin.css";

const target = document.getElementById("app");
if (target) mount(App, { target });
