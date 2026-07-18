import React, { useState } from "react";
import {
  IonContent,
  IonPage,
  IonItem,
  IonLabel,
  IonInput,
  IonButton,
  IonText,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonSelect,
  IonSelectOption,
} from "@ionic/react";
import { Redirect, useHistory } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { register, user } = useAuth();
  const history = useHistory();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("student");
  const [studentId, setStudentId] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Redirect to="/app/dashboard" />;

  const handleRegister = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await register({ name, email, password, role, studentId, department });
      history.replace("/app/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Register</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonItem>
          <IonLabel position="stacked">Full Name</IonLabel>
          <IonInput value={name} onIonInput={(e) => setName(e.detail.value || "")} />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Email</IonLabel>
          <IonInput
            type="email"
            value={email}
            onIonInput={(e) => setEmail(e.detail.value || "")}
          />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Password</IonLabel>
          <IonInput
            type="password"
            value={password}
            onIonInput={(e) => setPassword(e.detail.value || "")}
          />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Role</IonLabel>
          <IonSelect value={role} onIonChange={(e) => setRole(e.detail.value)}>
            <IonSelectOption value="student">Student</IonSelectOption>
            <IonSelectOption value="employee">Employee</IonSelectOption>
          </IonSelect>
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Student / Employee ID</IonLabel>
          <IonInput value={studentId} onIonInput={(e) => setStudentId(e.detail.value || "")} />
        </IonItem>
        <IonItem>
          <IonLabel position="stacked">Department</IonLabel>
          <IonInput value={department} onIonInput={(e) => setDepartment(e.detail.value || "")} />
        </IonItem>

        {error && (
          <IonText color="danger">
            <p>{error}</p>
          </IonText>
        )}

        <IonButton
          expand="block"
          className="ion-margin-top"
          onClick={handleRegister}
          disabled={submitting || !name || !email || !password}
        >
          {submitting ? "Creating account..." : "Register"}
        </IonButton>

        <IonButton expand="block" fill="clear" routerLink="/login">
          Already have an account? Login
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
