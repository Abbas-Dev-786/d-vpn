import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/layout";
import { setBaseUrl } from "@/api";
import NotFound from "@/pages/not-found";

// Initialize API base URL from environment
const apiUrl = import.meta.env.VITE_API_URL;
if (apiUrl) {
  setBaseUrl(apiUrl);
}

// Pages
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Nodes from "@/pages/nodes";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

type ProtectedRouteProps = {
  component: React.ComponentType;
};

// A wrapper to protect routes
function ProtectedRoute({ component: Component }: ProtectedRouteProps) {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  if (!isAuthenticated) {
    // Redirect to login if not authenticated
    // We do this in a microtask to avoid react rendering warnings
    Promise.resolve().then(() => setLocation("/"));
    return null;
  }

  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      
      {/* Protected Routes wrapped in Layout */}
      <Route path="/dashboard">
        {() => (
          <AppLayout>
            <ProtectedRoute component={Dashboard} />
          </AppLayout>
        )}
      </Route>
      
      <Route path="/nodes">
        {() => (
          <AppLayout>
            <ProtectedRoute component={Nodes} />
          </AppLayout>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
