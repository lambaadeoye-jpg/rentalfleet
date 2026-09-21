import { getVehicleCategories } from "./actions";
import CategoryList from "./category-list";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await getVehicleCategories();

  return (
    <div style={{ padding: "32px 40px" }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Vehicle Categories</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Renters select a category, never a specific VIN -- these are what they choose from.
      </p>
      <CategoryList initialCategories={categories} />
    </div>
  );
}
