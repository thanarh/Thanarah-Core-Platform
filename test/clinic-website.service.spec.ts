import { describe, expect, it, vi } from 'vitest';
import type {
  DoctorPersistencePort,
  ServiceCatalogPersistencePort,
} from '../src/persistence/platform-persistence.ports';
import type { ClinicWebsiteStore } from '../src/tenant/clinic-website.store';
import { ClinicWebsiteService } from '../src/tenant/clinic-website.service';
import { defaultClinicWebsiteDraft } from '../src/tenant/clinic-website.model';

const tenantId = 'c1e91c17-1213-41fb-a84f-3ff4a8bed1e2';

describe('ClinicWebsiteService public catalog', () => {
  it('returns only selected active catalog records and public fields', async () => {
    const draft = defaultClinicWebsiteDraft('clinic-public');
    const doctorId = 'f99d8975-6e60-4f3e-9ba1-c3255ee43ca0';
    const serviceId = 'a1337fc1-6628-420b-afb7-82de21b36dbb';
    draft.pages[0].sections = [
      {
        id: 'a8d731df-29a1-4cc5-b680-d164cc7e0340',
        type: 'doctorList',
        content: {},
        sourceIds: [doctorId],
      },
      {
        id: 'a1bf70a8-9441-4289-a16f-e51ff2cc74cf',
        type: 'serviceList',
        content: {},
        sourceIds: [serviceId],
      },
    ];
    draft.pages.push({
      id: 'af69cb99-13d1-451d-bb91-f10acb3f0f84',
      slug: 'private-page',
      title: 'صفحة غير منشورة',
      visible: false,
      sections: [
        {
          id: '67146227-1530-4ea1-931d-38928d201bbf',
          type: 'richText',
          content: { text: 'محتوى خاص غير منشور' },
          sourceIds: [],
        },
      ],
    });
    const store = {
      findPublishedBySlug: vi.fn(async () => ({
        tenantId,
        version: 3,
        draft,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      })),
    };
    const doctors = {
      listForTenant: vi.fn(async () => [
        {
          id: doctorId,
          status: 'ACTIVE',
          staff: { status: 'ACTIVE', displayName: 'د. نورة', userId: 'private-user-id' },
          professionalDisplayName: 'د. نورة',
          professionalTitle: 'استشارية',
          bio: 'نبذة منشورة',
          specialtyAssignments: [
            { specialty: { name: 'طب الأسرة', status: 'ACTIVE' } },
            { specialty: { name: 'تخصص داخلي', status: 'DEACTIVATED' } },
          ],
          privatePhone: '0500000000',
        },
        {
          id: 'b431bdb3-6f4e-4c5d-967e-0a6e681e8b4a',
          status: 'ACTIVE',
          staff: { status: 'ACTIVE', displayName: 'طبيب غير مختار', userId: 'another-user' },
          specialtyAssignments: [],
        },
        {
          id: '0c271d35-18e0-4133-a72d-164dd720caed',
          status: 'ACTIVE',
          staff: { status: 'SUSPENDED', displayName: 'طبيب معطل', userId: 'disabled-user' },
          specialtyAssignments: [],
        },
      ]),
    };
    const services = {
      list: vi.fn(async () => ({
        items: [
          {
            id: serviceId,
            name: 'استشارة',
            description: 'وصف منشور',
            status: 'ACTIVE',
            privateCost: 500,
          },
          {
            id: '6e2bfa84-8faf-45f4-8ee1-4db512b8a749',
            name: 'خدمة غير مختارة',
            description: null,
            status: 'ACTIVE',
          },
          {
            id: '907530eb-8bc9-4dd8-b97e-44e6d075ecdf',
            name: 'خدمة معطلة',
            description: null,
            status: 'DEACTIVATED',
          },
        ],
        total: 3,
      })),
    };
    const service = new ClinicWebsiteService(
      store as unknown as ClinicWebsiteStore,
      doctors as unknown as DoctorPersistencePort,
      services as unknown as ServiceCatalogPersistencePort,
    );

    const site = await service.publicSite('clinic-public');
    expect(site.catalog.doctors).toEqual([
      {
        id: doctorId,
        displayName: 'د. نورة',
        title: 'استشارية',
        bio: 'نبذة منشورة',
        specialties: ['طب الأسرة'],
      },
    ]);
    expect(site.catalog.services).toEqual([
      { id: serviceId, name: 'استشارة', description: 'وصف منشور' },
    ]);
    expect(site.publishedVersion.draft.pages).toHaveLength(1);
    expect(JSON.stringify(site)).not.toContain('محتوى خاص غير منشور');
    expect(JSON.stringify(site)).not.toContain('privatePhone');
    expect(JSON.stringify(site)).not.toContain('privateCost');
    expect(JSON.stringify(site)).not.toContain('private-user-id');
  });
});
