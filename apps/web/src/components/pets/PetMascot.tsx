import { usePetSelection, usePrimaryPetCatalog } from "../../pets";
import { PetSprite } from "./PetSprite";

export function PetMascot() {
  const { environmentId, catalog } = usePrimaryPetCatalog();
  const { selectedPet } = usePetSelection(environmentId, catalog);
  if (environmentId === null || selectedPet === null) return null;

  return (
    <div
      className="pointer-events-none fixed right-4 bottom-3 z-30 hidden drop-shadow-[0_8px_10px_rgba(0,0,0,0.22)] lg:block"
      data-pet-mascot={selectedPet.key}
    >
      <PetSprite environmentId={environmentId} pet={selectedPet} animate size={104} />
    </div>
  );
}
