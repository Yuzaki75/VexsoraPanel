import { config } from "./config.js";
import { getDb } from "./db/index.js";
import "./http.js";

getDb();
console.log(`[panel] database ready at ${config.dbPath}`);
