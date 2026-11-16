import { Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_PERSISTENCE,
  SERVICE_CATALOG_PERSISTENCE,
  type DoctorPersistencePort,
  type ServiceCatalogPersistencePort,
} from '../persistence/platform-persistence.ports';
import type { TrustedTenantContext } from './tenant-context.contract';
import {
  ClinicWebsiteStore,
  type ClinicWebsiteState,
  type PublishedClinicWebsite,
} from './clinic-website.store';
import type { ClinicWebsiteVersion } from './clinic-website.model';

export interface PublicClinicWebsite {
  publishedVersion: {
    version: number;
    publishedAt: Date;
    draft: PublishedClinicWebsite['draft'];
  };
  catalog: ClinicWebsiteCatalog;
}

export interface ClinicWebsiteCatalog {
  doctors: Array<{
    id: string;
    displayName: string;
    title: string | null;
    bio: string | null;
    specialties: string[];
  }>;
  services: Array<{ id: string; name: string; description: string | null }>;
}

@Injectable()
export class ClinicWebsiteService {
  constructor(
    private readonly store: ClinicWebsiteStore,
    @Inject(DOCTOR_PERSISTENCE) private readonly doctors: DoctorPersistencePort,
    @Inject(SERVICE_CATALOG_PERSISTENCE)
    private readonly services: ServiceCatalogPersistencePort,
  ) {}

  get(context: TrustedTenantContext, actorId: string): Promise<ClinicWebsiteState> {
    return this.store.get(context.tenantId, actorId);
  }

  saveDraft(
    context: TrustedTenantContext,
    actorId: string,
    expectedVersion: number,
    draft: unknown,
  ): Promise<ClinicWebsiteState> {
    return this.store.saveDraft(context.tenantId, actorId, expectedVersion, draft);
  }

  publish(
    context: TrustedTenantContext,
    actorId: string,
    expectedVersion: number,
  ): Promise<ClinicWebsiteState> {
    return this.store.publish(context.tenantId, actorId, expectedVersion);
  }

  restore(
    context: TrustedTenantContext,
    actorId: string,
    version: number,
    expectedVersion: number,
  ): Promise<ClinicWebsiteState> {
    return this.store.restore(context.tenantId, actorId, version, expectedVersion);
  }

  listVersions(context: TrustedTenantContext): Promise<ClinicWebsiteVersion[]> {
    return this.store.listVersions(context.tenantId);
  }

  async editorCatalog(context: TrustedTenantContext): Promise<ClinicWebsiteCatalog> {
    return this.loadCatalog(context.tenantId);
  }

  async publicSite(slug: string): Promise<PublicClinicWebsite> {
    const site = await this.store.findPublishedBySlug(slug);
    const draft = {
      ...site.draft,
      pages: site.draft.pages.filter((page) => page.visible),
    };
    const selectedIds = this.selectedCatalogIds(draft);
    const catalog = await this.loadCatalog(site.tenantId, selectedIds);
    return {
      publishedVersion: {
        version: site.version,
        publishedAt: site.publishedAt,
        draft,
      },
      catalog,
    };
  }

  private async loadCatalog(
    tenantId: string,
    selected?: { doctors: Set<string>; services: Set<string> },
  ): Promise<ClinicWebsiteCatalog> {
    const [doctors, services] = await Promise.all([
      this.doctors.listForTenant(tenantId, {
        status: 'ACTIVE',
        limit: 100,
        offset: 0,
      }),
      this.services.list(tenantId, {
        status: 'ACTIVE',
        limit: 100,
        offset: 0,
      }),
    ]);
    return {
      doctors: doctors
        .filter(
          (doctor) =>
            doctor.status === 'ACTIVE' &&
            doctor.staff.status === 'ACTIVE' &&
            Boolean(doctor.professionalDisplayName) &&
            (!selected || selected.doctors.has(doctor.id)),
        )
        .map((doctor) => ({
          id: doctor.id,
          displayName: doctor.professionalDisplayName!,
          title: doctor.professionalTitle,
          bio: doctor.bio,
          specialties: doctor.specialtyAssignments
            .filter((assignment) => assignment.specialty.status === 'ACTIVE')
            .map((assignment) => assignment.specialty.name),
        })),
      services: services.items
        .filter(
          (service) =>
            service.status === 'ACTIVE' && (!selected || selected.services.has(service.id)),
        )
        .map((service) => ({
          id: service.id,
          name: service.name,
          description: service.description,
        })),
    };
  }

  private selectedCatalogIds(draft: PublishedClinicWebsite['draft']): {
    doctors: Set<string>;
    services: Set<string>;
  } {
    const doctors = new Set<string>();
    const services = new Set<string>();
    for (const page of draft.pages) {
      if (!page.visible) continue;
      for (const section of page.sections) {
        if (!['doctorList', 'serviceList'].includes(section.type)) continue;
        for (const id of section.sourceIds) {
          (section.type === 'doctorList' ? doctors : services).add(id);
        }
      }
    }
    return { doctors, services };
  }
}
