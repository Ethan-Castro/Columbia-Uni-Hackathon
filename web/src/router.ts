// Tiny hash router (no dependency): #/ , #/submit , #/admin , #/insights
import { useEffect, useState } from "react";

export type Route = "directory" | "submit" | "admin" | "insights";

const ROUTES: Record<string, Route> = {
  "": "directory",
  submit: "submit",
  admin: "admin",
  insights: "insights",
};

export const HREF: Record<Route, string> = {
  directory: "#/",
  submit: "#/submit",
  admin: "#/admin",
  insights: "#/insights",
};

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split(/[/?]/)[0];
  return ROUTES[path] ?? "directory";
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
