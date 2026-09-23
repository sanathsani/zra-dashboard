/* Client Review.
   The review is a large, self-contained report with its own stylesheet, its
   own SVG charts and its own PowerPoint/PDF writers. It runs in an iframe so
   none of that can collide with the dashboard's styles — but it is not a
   separate app: the dashboard's date filter and theme drive it over
   postMessage, and it reads the same session, so there is one filter and one
   sign-in for the whole site. */
import { useEffect, useRef } from "react";
import { clearSession } from "../SignIn.jsx";

export default function Review({ from, to, theme, data }) {
  const frame = useRef(null);
  const ready = useRef(false);
  // The review used to fetch /api/data for itself, so opening this page pulled
  // the whole feed through Apps Script a second time — half the wait, and half
  // the timeouts. It asks for the copy already in memory instead.
  const wants = useRef(false);
  const latest = useRef({ data, from, to, theme });
  latest.current = { data, from, to, theme };

  function sendFeed() {
    const { data: d, from: f, to: t, theme: th } = latest.current;
    if (!d || !frame.current?.contentWindow) return false;
    frame.current.contentWindow.postMessage(
      { type: "skild:feed", data: d, range: { from: f, to: t }, theme: th === "dark" ? "dark" : "light" },
      location.origin,
    );
    return true;
  }

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
        return;
      }
      // The iframe is up and asking for the feed. If it has not arrived yet,
      // remember the request and send it the moment it does.
      if (e.data?.type === "skild:review" && e.data.want === "feed") {
        wants.current = true;
        if (sendFeed()) wants.current = false;
      }
    }
    addEventListener("message", onMessage);
    return () => removeEventListener("message", onMessage);
  }, []);

  // Data arrived, or was refreshed. Push it either way: the frame needs the
  // new numbers as much as it needed the first ones.
  useEffect(() => {
    if (sendFeed()) wants.current = false;
  }, [data]);

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
      onLoad={() => { ready.current = true; sendFeed(); }}
      allow="fullscreen"
      allowFullScreen
      style={{ display: "block", width: "100%", border: 0, background: "transparent" }}
    />
  );
}
