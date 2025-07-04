import { ICompany } from 'server/src/interfaces/company.interfaces';
import { IDocument } from 'server/src/interfaces/document.interface';
import { IContact } from "server/src/interfaces/contact.interfaces";
import { getDocumentByCompanyId } from 'server/src/lib/actions/document-actions/documentActions';
import CompanyDetails from 'server/src/components/companies/CompanyDetails';
import { getContactsByCompany } from 'server/src/lib/actions/contact-actions/contactActions';
import { getCompanyById } from 'server/src/lib/actions/company-actions/companyActions';
import { notFound } from 'next/navigation';

const CompanyPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const resolvedParams = await params;
  const { id } = resolvedParams;
 
  try {
    // Fetch all data in parallel
    const [company, documents, contacts] = await Promise.all([
      getCompanyById(id),
      getDocumentByCompanyId(id),
      getContactsByCompany(id, 'all')
    ]);

    if (!company) {
      return notFound();
    }

    return (
      <div className="mx-auto px-4">
       <CompanyDetails company={company} documents={documents} contacts={contacts} isInDrawer={false} />
      </div>
    );
  } catch (error) {
    console.error(`Error fetching data for company with id ${id}:`, error);
    return <div>Error loading company data</div>;
  }
}

export default CompanyPage;
