/* Client Review.
   The review is a large, self-contained report with its own stylesheet, its
   own SVG charts and its own PowerPoint/PDF writers. It runs in an iframe so
   none of that can collide with the dashboard's styles — but it is not a
   separate app: the dashboard's date filter and theme drive it over
   postMessage, and it reads the same session, so there is one filter and one
   sign-in for the whole site. */
import { useEffect, useRef } from "react";
import { clearSession } from "../SignIn.jsx";

export default function Review({ from, to, theme }) {
  const frame = useRef(null);
  const ready = useRef(false);

  // Only the first load carries the range in the URL; after that it is pushed,
  // so changing the date filter never costs another fetch of the feed.
  const src = useRef(
    `/review.html?embed=1&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&theme=${theme === "dark" ? "dark" : "light"}`
  ).current;

  useEffect(() => {
    function onMessage(e) {
      if (e.source !== frame.current?.contentWindow) return;
      if (e.data?.type === "skild:review" && e.data.signedOut) {
        clearSession();
        location.reload();
      }
    }
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    if (!ready.current) return;
    frame.current?.contentWindow?.postMessage(
      { type: "skild:review", from, to, theme: theme === "dark" ? "dark" : "light" },
      location.origin
    );
  }, [from, to, theme]);

  return (
    <iframe
      ref={frame}
      title="Client Review"
      src={src}
      onLoad={() => { ready.current = true; }}
      allow="fullscreen"
      allowFullScreen
      style={{ display: "block", width: "100%", border: 0, background: "transparent" }}
    />
  );
}
