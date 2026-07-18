import React from "react";
import { Redirect, Route } from "react-router-dom";
import {
  IonApp,
  IonIcon,
  IonLabel,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
} from "@ionic/react";
import { IonReactRouter } from "@ionic/react-router";
import {
  homeOutline,
  cameraOutline,
  timeOutline,
  personOutline,
} from "ionicons/icons";

import { AuthProvider, useAuth } from "./context/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";

import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import MarkAttendance from "./pages/MarkAttendance";
import History from "./pages/History";
import Profile from "./pages/Profile";

setupIonicReact();

function AuthedTabs() {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route exact path="/app/dashboard" component={Dashboard} />
        <Route exact path="/app/mark" component={MarkAttendance} />
        <Route exact path="/app/history" component={History} />
        <Route exact path="/app/profile" component={Profile} />
        <Route exact path="/app">
          <Redirect to="/app/dashboard" />
        </Route>
      </IonRouterOutlet>
      <IonTabBar slot="bottom">
        <IonTabButton tab="dashboard" href="/app/dashboard">
          <IonIcon icon={homeOutline} />
          <IonLabel>Dashboard</IonLabel>
        </IonTabButton>
        <IonTabButton tab="mark" href="/app/mark">
          <IonIcon icon={cameraOutline} />
          <IonLabel>Mark</IonLabel>
        </IonTabButton>
        <IonTabButton tab="history" href="/app/history">
          <IonIcon icon={timeOutline} />
          <IonLabel>History</IonLabel>
        </IonTabButton>
        <IonTabButton tab="profile" href="/app/profile">
          <IonIcon icon={personOutline} />
          <IonLabel>Profile</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();

  return (
    <IonRouterOutlet id="root-outlet">
      <Route exact path="/login" component={Login} />
      <Route exact path="/register" component={Register} />
      <ProtectedRoute path="/app">
        <AuthedTabs />
      </ProtectedRoute>
      <Route exact path="/">
        {loading ? null : <Redirect to={user ? "/app/dashboard" : "/login"} />}
      </Route>
    </IonRouterOutlet>
  );
}

export default function App() {
  return (
    <IonApp>
      <AuthProvider>
        <IonReactRouter>
          <AppRoutes />
        </IonReactRouter>
      </AuthProvider>
    </IonApp>
  );
}
