import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import GuidesPage from "./pages/GuidesPage";
import ReferencePage from "./pages/ReferencePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="guides" element={<GuidesPage />} />
        <Route path="guides/:section" element={<GuidesPage />} />
        <Route path="reference" element={<ReferencePage />} />
        <Route path="reference/:section" element={<ReferencePage />} />
      </Route>
    </Routes>
  );
}
