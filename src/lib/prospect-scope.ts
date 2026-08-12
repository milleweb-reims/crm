// Portée de visibilité des prospects, par rôle.
//
// Fonction pure : aucune requête, donc testable sans base. Les données dont elle
// a besoin (les villes des territoires du closer) lui sont passées, et sont
// résolues par territory-service.closerCityKeys().

/** Filtre MongoDB. Volontairement lâche : la forme dépend des paramètres reçus. */
type Filter = Readonly<Record<string, unknown>>;

export interface ProspectFilterParams {
  readonly status?: string | null;
  readonly assignedTo?: string | null;
  readonly search?: string | null;
  readonly city?: string | null;
  readonly rdv?: string | null;
  readonly paid?: string | null;
  readonly view?: string | null;
  readonly userRole: string;
  readonly userId: string;
  /**
   * cityKey des territoires où l'utilisateur est closer. Vide pour les autres
   * rôles, qui n'ont pas de portée territoriale.
   */
  readonly territoryCityKeys: ReadonlyArray<string>;
}

/**
 * Intersecte des filtres sans écraser de clé.
 *
 * `$and` plutôt qu'un spread : deux moitiés peuvent porter un `$or` — la
 * recherche texte d'un côté, la portée de visibilité de l'autre — et un spread
 * en perdrait un **silencieusement**. Une portée perdue, c'est un closer qui
 * voit tout.
 */
function intersect(...filters: ReadonlyArray<Filter>): Filter {
  const parts = filters.filter((filter) => Object.keys(filter).length > 0);

  if (parts.length === 0) return {};
  if (parts.length === 1) return parts[0]!;
  return { $and: parts };
}

/** Filtres demandés par l'appelant (URL) : recherche, statut, ville, dates. */
function requestedFilter(params: ProspectFilterParams): Filter {
  return {
    ...(params.status && { status: params.status }),
    ...(params.assignedTo && { assignedTo: params.assignedTo }),
    ...(params.rdv === "upcoming" && { rdvDate: { $gte: new Date() } }),
    ...(params.paid === "month" && {
      paidAt: {
        $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
    }),
    ...(params.city && {
      "address.city": { $regex: params.city, $options: "i" },
    }),
    ...(params.search && {
      $or: [
        { name: { $regex: params.search, $options: "i" } },
        { phone: { $regex: params.search, $options: "i" } },
        { email: { $regex: params.search, $options: "i" } },
        { "address.city": { $regex: params.search, $options: "i" } },
      ],
    }),
  };
}

/**
 * Portée d'un closer : les prospects des villes de ses territoires, plus ceux
 * qui lui sont attribués.
 *
 * Les deux moitiés du `$or` sont nécessaires :
 *   - la ville, parce qu'un territoire est un périmètre de démarchage partagé —
 *     c'est ce qui permet à un closer qu'on vient d'ajouter sur Reims de voir
 *     immédiatement le stock de Reims, sans attendre une réattribution ;
 *   - l'attribution, parce qu'un dossier en cours ne doit jamais disparaître de
 *     sa liste si l'admin retire la ville de son territoire.
 *
 * Sans aucun territoire, la portée se réduit à ses attributions : un closer
 * sans ville ne découvre pas le CRM entier.
 */
function closerScope(params: ProspectFilterParams): Filter {
  if (params.territoryCityKeys.length === 0) {
    return { assignedTo: params.userId };
  }

  return {
    $or: [
      { assignedTo: params.userId },
      { "address.cityKey": { $in: [...params.territoryCityKeys] } },
    ],
  };
}

/**
 * Portée d'un dev : uniquement les fiches vendues ou en rendez-vous, et hors du
 * tableau de livraison, uniquement celles dont le site reste à démarrer.
 */
function devScope(params: ProspectFilterParams): Filter {
  const sold = { status: { $in: ["rdv", "paye"] } };

  if (params.view === "delivery") return sold;

  return intersect(sold, { $or: [{ devUrl: null }, { devUrl: "" }] });
}

/**
 * Construit le filtre MongoDB d'une liste de prospects.
 *
 * La portée du rôle est **intersectée** avec les filtres demandés, jamais
 * fusionnée par-dessus : un closer qui passerait `?assignedTo=<un autre>` obtient
 * l'intersection avec sa portée, donc rien qu'il n'avait pas déjà le droit de
 * voir. Aucun paramètre d'URL ne peut élargir la portée.
 */
export function buildProspectFilter(params: ProspectFilterParams): Filter {
  const requested = requestedFilter(params);

  if (params.userRole === "closer") {
    return intersect(requested, closerScope(params));
  }

  if (params.userRole === "dev") {
    return intersect(requested, devScope(params));
  }

  return requested;
}
