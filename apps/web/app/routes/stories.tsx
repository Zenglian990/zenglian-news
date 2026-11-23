import { redirect } from "react-router";

export function loader() {
  return redirect("/hot", 302);
}

export default function StoriesRedirect() {
  return null;
}
