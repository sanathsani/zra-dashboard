import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import SignIn, { getSession } from "./SignIn.jsx";

/* The dashboard is not rendered, and no ticket data is requested, until a
   session exists. /api/data refuses without the token this hands out. */
function Root() {
  const [session, setSession] = useState(getSession);
  if (!session) return <SignIn onDone={setSession} />;
  return <App session={session} />;
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
