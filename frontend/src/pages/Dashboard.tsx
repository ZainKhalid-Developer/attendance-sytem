import React, { useEffect, useState } from "react";
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonBadge,
  IonButton,
  IonSpinner,
  IonRefresher,
  IonRefresherContent,
  RefresherEventDetail,
} from "@ionic/react";
import { useAuth } from "../context/AuthContext";
import { api, AttendanceRecord } from "../api/client";

export default function Dashboard() {
  const { user, refreshUser } = useAuth();
  const [today, setToday] = useState<{ marked: boolean; record: AttendanceRecord | null } | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [todayStatus] = await Promise.all([api.today(), refreshUser()]);
      setToday(todayStatus);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRefresh = async (event: CustomEvent<RefresherEventDetail>) => {
    await load();
    event.detail.complete();
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Dashboard</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <h2>Hi, {user?.name}</h2>

        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Today's Status</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            {loading ? (
              <IonSpinner />
            ) : today?.marked ? (
              <IonBadge color="success">Present</IonBadge>
            ) : (
              <>
                <IonBadge color="warning">Not marked yet</IonBadge>
                <div className="ion-margin-top">
                  <IonButton routerLink="/app/mark" expand="block">
                    Mark Attendance
                  </IonButton>
                </div>
              </>
            )}
          </IonCardContent>
        </IonCard>

        <IonCard>
          <IonCardHeader>
            <IonCardTitle>Attendance Percentage</IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <h1>{user?.attendancePercent ?? 0}%</h1>
          </IonCardContent>
        </IonCard>
      </IonContent>
    </IonPage>
  );
}
