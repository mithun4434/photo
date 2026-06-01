import { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initDriveAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getDriveAccessToken = async (): Promise<string | null> => {
  if (cachedAccessToken) return cachedAccessToken;
  
  // If no cached token, user needs to sign in again
  return null;
};

export const googleSignOut = async () => {
  await signOut(auth);
  cachedAccessToken = null;
};

export function useDriveAuth() {
  const [driveUser, setDriveUser] = useState<User | null>(null);
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);

  useEffect(() => {
    const unsubscribe = initDriveAuth(
      (u, t) => {
        setDriveUser(u);
        setDriveToken(t);
        setNeedsAuth(false);
      },
      () => {
        setDriveUser(null);
        setDriveToken(null);
        setNeedsAuth(true);
      }
    );
    return () => unsubscribe();
  }, []);

  const login = async () => {
    const res = await googleSignIn();
    if (res) {
      setDriveUser(res.user);
      setDriveToken(res.accessToken);
      setNeedsAuth(false);
    }
  };

  const logout = async () => {
    await googleSignOut();
    setDriveUser(null);
    setDriveToken(null);
    setNeedsAuth(true);
  };

  return { driveUser, driveToken, needsAuth, login, logout };
}
