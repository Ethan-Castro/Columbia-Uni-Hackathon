// Tiny hash router (no dependency): #/ (home), #/directory , #/graph , #/submit , #/community , #/admin , #/insights
import { useEffect, useState } from "react";

export type Route = "home" | "directory" | "graph" | "submit" | "community" | "admin" | "insights";

const ROUTES: Record<string, Route> = {
  "": "home",
  directory: "directory",
  graph: "graph",
  submit: "submit",
  community: "community",
  admin: "admin",
  insights: "insights",
};

export const HREF: Record<Route, string> = {
  home: "#/",
  directory: "#/directory",
  graph: "#/graph",
  submit: "#/submit",
  community: "#/community",
  admin: "#/admin",
  insights: "#/insights",
};

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES[path] ?? "home";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      // In-page anchors (#how) keep the route and just scroll.
      if (!window.location.hash.startsWith("#/") && window.location.hash.length > 1) return;
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
