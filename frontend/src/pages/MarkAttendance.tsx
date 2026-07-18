import React, { useState } from "react";
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButton,
  IonText,
  IonImg,
  IonSpinner,
  IonList,
  IonItem,
  IonLabel,
} from "@ionic/react";
import { Geolocation } from "@capacitor/geolocation";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";
import { useHistory } from "react-router-dom";
import { api } from "../api/client";

type Step = "idle" | "locating" | "capturing" | "submitting" | "success" | "error";

async function resolvePlaceName(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const parts = [
      data.locality || data.city,
      data.principalSubdivision,
      data.countryName,
    ].filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0);
    const unique = Array.from(new Set(parts));
    return unique.length > 0 ? unique.join(", ") : null;
  } catch {
    return null;
  }
}

export default function MarkAttendance() {
  const history = useHistory();
  const [step, setStep] = useState<Step>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const handleMarkAttendance = async () => {
    setMessage(null);
    setPlace(null);
    setStep("locating");
    try {
      const position = await Geolocation.getCurrentPosition({ enableHighAccuracy: true });
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;
      setCoords({ lat, lon });
      void resolvePlaceName(lat, lon).then((name) =>
        setPlace(name ?? "Location name unavailable")
      );

      setStep("capturing");
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera,
        quality: 80,
      });

      if (!photo.webPath) {
        throw new Error("Could not capture photo");
      }
      setPhotoPreview(photo.webPath);

      setStep("submitting");
      const response = await fetch(photo.webPath);
      const blob = await response.blob();

      await api.markAttendance(lat, lon, blob);
      setStep("success");
      setMessage("Attendance marked successfully.");
    } catch (err) {
      setStep("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar>
          <IonTitle>Mark Attendance</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        <IonText>
          <p>
            Tap the button below. We'll check that you're within the authorized location, then
            open the camera for a verification selfie.
          </p>
        </IonText>

        <IonButton
          expand="block"
          onClick={handleMarkAttendance}
          disabled={step === "locating" || step === "capturing" || step === "submitting"}
        >
          {step === "idle" || step === "error" || step === "success"
            ? "Mark Attendance"
            : "Working..."}
        </IonButton>

        {(step === "locating" || step === "capturing" || step === "submitting") && (
          <div className="ion-text-center ion-margin-top">
            <IonSpinner />
            <p>
              {step === "locating" && "Checking your location..."}
              {step === "capturing" && "Opening camera..."}
              {step === "submitting" && "Submitting attendance..."}
            </p>
          </div>
        )}

        {photoPreview && (
          <IonImg src={photoPreview} style={{ maxWidth: 240, margin: "16px auto" }} />
        )}

        {coords && (
          <IonList inset>
            <IonItem lines="none">
              <IonLabel className="ion-text-wrap">
                <h2>{place ?? "Resolving address…"}</h2>
                <p>
                  {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
                </p>
              </IonLabel>
            </IonItem>
          </IonList>
        )}

        {message && (
          <IonText color={step === "success" ? "success" : "danger"}>
            <p>
              <strong>{step === "success" ? "Attendance Recorded" : "Attendance Failed"}</strong>
              <br />
              {message}
            </p>
          </IonText>
        )}

        {step === "success" && (
          <IonButton expand="block" fill="clear" onClick={() => history.replace("/app/dashboard")}>
            Back to Dashboard
          </IonButton>
        )}
      </IonContent>
    </IonPage>
  );
}
