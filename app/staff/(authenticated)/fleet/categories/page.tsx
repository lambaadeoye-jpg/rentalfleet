import { getVehicleCategories } from "./actions";
import CategoryList from "./category-list";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await getVehicleCategories();

  return (
    <div className="page">
      <h1 className="page-title">Vehicle categories</h1>
      <p className="muted-text" style={{ marginBottom: 20 }}>
        Renters select a category, never a specific VIN — these are what they choose from.
      </p>
      <CategoryList initialCategories={categories} />
    </div>
  );
}
