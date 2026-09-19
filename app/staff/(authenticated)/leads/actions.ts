"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function updateLeadStage(
  leadId: string,
  stage: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.from("lead").update({ stage }).eq("id", leadId);

  if (error) {
    return { success: false, error: "Couldn't update that lead. Please try again." };
  }

  revalidatePath("/staff/leads");
  return { success: true };
}
