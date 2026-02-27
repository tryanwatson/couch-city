import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    server: {
        allowedHosts: ["alexa-uncasual-apogamously.ngrok-free.dev"],
        port: 3001,
        proxy: {
            "/socket.io": {
                target: "http://localhost:3001",
                ws: true,
            },
        },
    },
});
