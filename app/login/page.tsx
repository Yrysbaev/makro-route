"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import makroLogo from "../../makrofood.png";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error ?? "Login failed");
      }

      router.replace("/");
      router.refresh();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Login failed";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(180deg, #f0f4ff 0%, #eef2f7 100%)",
        padding: 16,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          border: "1px solid #c8daee",
          borderRadius: 14,
          padding: 20,
          display: "grid",
          gap: 12,
          boxShadow: "0 14px 36px rgba(13, 79, 143, 0.16)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Image
            src={makroLogo}
            alt="Makro Food logo"
            width={82}
            height={82}
            style={{ borderRadius: 999, border: "2px solid #0d4f8f" }}
            priority
          />
        </div>
        <h1 style={{ margin: 0, fontSize: 28, color: "#0f172a" }}>Driver Login</h1>
        <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>
          Sign in to access Makro Route.
        </p>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#000000" }}>
            Username
          </span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
            style={{
              border: "1px solid #94a3b8",
              borderRadius: 8,
              padding: "10px 12px",
              background: "#0d4f8f",
              color: "#ffffff",
              caretColor: "#ffffff",
              fontSize: 16,
            }}
          />
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#000000" }}>
            Password
          </span>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
            style={{
              border: "1px solid #94a3b8",
              borderRadius: 8,
              padding: "10px 12px",
              background: "#0d4f8f",
              color: "#ffffff",
              caretColor: "#ffffff",
              fontSize: 16,
            }}
          />
        </label>

        {error ? (
          <p
            style={{
              margin: 0,
              color: "#991b1b",
              fontSize: 13,
              background: "#fee2e2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            marginTop: 4,
            border: 0,
            borderRadius: 8,
            padding: "10px 12px",
            background: "#0d4f8f",
            color: "#fff",
            fontWeight: 700,
            cursor: isSubmitting ? "not-allowed" : "pointer",
            opacity: isSubmitting ? 0.7 : 1,
          }}
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </main>
  );
}
