import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import ManagementApp from "./ManagementApp";
import "./styles.css";
import "./filter.css";
import "./dialogs.css";
import "./editor-layout.css";
import "./management.css";
import "./sync-help.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, retry: 1 } },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {window.location.pathname.startsWith("/management") ? (
        <ManagementApp />
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </StrictMode>,
);
