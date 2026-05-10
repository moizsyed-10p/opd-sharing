import { BrowserRouter, Route, Routes } from "react-router-dom";
import { DefaultProviders } from "./components/providers/default.tsx";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import AppLayout from "./pages/app/_components/AppLayout.tsx";
import GroupsPage from "./pages/app/groups/page.tsx";
import GroupDetailPage from "./pages/app/groups/[groupId]/page.tsx";

export default function App() {
  return (
    <DefaultProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route element={<AppLayout />}>
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/groups/:groupId" element={<GroupDetailPage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </DefaultProviders>
  );
}