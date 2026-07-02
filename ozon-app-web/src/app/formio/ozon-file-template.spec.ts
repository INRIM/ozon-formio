import { ozonFileTemplate } from './ozon-file-template';

describe('ozonFileTemplate', () => {
  it('should render backend-managed file links without storage warning', () => {
    const html = ozonFileTemplate({
      files: [
        {
          filename: 'Inrim-QuiIAM-OFFERTA v4.pdf',
          url: '/test_request/test_request.b68/Inrim-QuiIAM-OFFERTA%20v4.pdf',
          content_type: 'application/pdf'
        }
      ],
      filesToUpload: [],
      filesToDelete: [],
      disabled: false,
      component: {},
      t: (value: string) => value,
      fileSize: (value: unknown) => `${value} Bytes`
    });

    expect(html).toContain('Inrim-QuiIAM-OFFERTA v4.pdf');
    expect(html).toContain('href="/client/attachment/test_request/test_request.b68/Inrim-QuiIAM-OFFERTA%20v4.pdf"');
    expect(html).not.toContain('No storage has been set');
  });
});
