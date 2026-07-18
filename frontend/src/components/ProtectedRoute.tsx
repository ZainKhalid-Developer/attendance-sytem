import React from "react";
import { Redirect, Route, RouteProps } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children, ...rest }: RouteProps) {
  const { user, loading } = useAuth();

  if (loading) return null;

  return (
    <Route {...rest}>{user ? children : <Redirect to="/login" />}</Route>
  );
}
