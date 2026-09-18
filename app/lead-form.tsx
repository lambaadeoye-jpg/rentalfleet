"use client";

import { useState, type FormEvent } from "react";
import { submitLead } from "./actions";

type VehicleCategory = { id: string; name: string; description: string | null };
type GigPlatform = { id: string; code: string; name: string };

export default function LeadForm({
  categories,
  platforms,
}: {
  categories: VehicleCategory[];
  platforms: GigPlatform[];
}) {
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

  function togglePlatform(id: string) {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);

    const result = await submitLead({
      firstName: String(form.get("firstName") || ""),
      lastName: String(form.get("lastName") || ""),
      phone: String(form.get("phone") || ""),
      email: String(form.get("email") || ""),
      drivingFor: String(form.get("drivingFor") || ""),
      preferredCategoryId: (form.get("preferredCategoryId") as string) || null,
      pickupDate: (form.get("pickupDate") as string) || null,
      rentalOption: (form.get("rentalOption") as "daily" | "weekly") || "weekly",
      additionalInfo: String(form.get("additionalInfo") || ""),
      gigPlatformIds: selectedPlatforms,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="card" style={{ textAlign: "center", padding: 48 }}>
        <h3 style={{ fontSize: 22, marginBottom: 8 }}>Thanks — we've got your request.</h3>
        <p className="muted-text">
          We'll review your information and follow up with the next step.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card">
      <h3 style={{ fontSize: 20, marginBottom: 4 }}>Let's find the right vehicle for your work.</h3>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Takes about a minute. No document uploads here — just the basics.
      </p>

      <div className="form-row">
        <div className="field">
          <label htmlFor="firstName">First name *</label>
          <input id="firstName" name="firstName" required autoComplete="given-name" />
        </div>
        <div className="field">
          <label htmlFor="lastName">Last name *</label>
          <input id="lastName" name="lastName" required autoComplete="family-name" />
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="phone">Mobile phone number *</label>
          <input id="phone" name="phone" type="tel" required autoComplete="tel" />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="email" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="drivingFor">What are you driving for?</label>
        <input id="drivingFor" name="drivingFor" placeholder="e.g. Uber, DoorDash, Amazon Flex..." />
      </div>

      <div className="field">
        <label>Platforms (select all that apply)</label>
        <div className="checkbox-grid">
          {platforms.map((p) => (
            <label key={p.id} className="checkbox-item">
              <input
                type="checkbox"
                checked={selectedPlatforms.includes(p.id)}
                onChange={() => togglePlatform(p.id)}
              />
              {p.name}
            </label>
          ))}
        </div>
      </div>

      <div className="form-row">
        <div className="field">
          <label htmlFor="preferredCategoryId">Preferred vehicle category</label>
          <select id="preferredCategoryId" name="preferredCategoryId" defaultValue="">
            <option value="">No preference</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="pickupDate">Desired start date</label>
          <input id="pickupDate" name="pickupDate" type="date" />
        </div>
      </div>

      <div className="field">
        <label>Rental option</label>
        <div style={{ display: "flex", gap: 20, marginTop: 6 }}>
          <label className="checkbox-item">
            <input type="radio" name="rentalOption" value="daily" />
            Daily
          </label>
          <label className="checkbox-item">
            <input type="radio" name="rentalOption" value="weekly" defaultChecked />
            Weekly
          </label>
        </div>
      </div>

      <div className="field">
        <label htmlFor="additionalInfo">Additional information (optional)</label>
        <textarea id="additionalInfo" name="additionalInfo" rows={3} />
      </div>

      {error && <p className="error-text" style={{ marginBottom: 12 }}>{error}</p>}

      <button type="submit" className="button-primary" disabled={loading} style={{ width: "100%" }}>
        {loading ? "Submitting..." : "Get Started"}
      </button>
    </form>
  );
}
