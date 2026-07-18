import React from "react";
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonList,
  IonItem,
  IonLabel,
  IonButton,
  IonAvatar,
} from "@ionic/react";
import { useHistory } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Profile() {
  const { user, logout } = useAuth();
  const history = useHistory();

  const handleLogout = () => {
    logout();
    history.replace("/login");
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Profile</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <div className="ion-text-center ion-margin-bottom">
          <IonAvatar style={{ margin: "0 auto", width: 96, height: 96 }}>
            <div
              style={{
                background: "var(--ion-color-primary)",
                color: "white",
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 32,
              }}
            >
              {user?.name?.charAt(0).toUpperCase()}
            </div>
          </IonAvatar>
        </div>

        <IonList inset>
          <IonItem>
            <IonLabel>
              <p>Name</p>
              <h2>{user?.name}</h2>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <p>Email</p>
              <h2>{user?.email}</h2>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <p>Student / Employee ID</p>
              <h2>{user?.student_id || "—"}</h2>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <p>Department</p>
              <h2>{user?.department || "—"}</h2>
            </IonLabel>
          </IonItem>
          <IonItem>
            <IonLabel>
              <p>Attendance Percentage</p>
              <h2>{user?.attendancePercent ?? 0}%</h2>
            </IonLabel>
          </IonItem>
        </IonList>

        <IonButton expand="block" color="danger" className="ion-margin-top" onClick={handleLogout}>
          Logout
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
