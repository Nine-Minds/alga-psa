"use client";
import { useRouter } from 'next/navigation';

export default function MasterTerms() {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-primary-600 mb-2">NINE MINDS</h1>
        <h2 className="text-2xl font-bold text-gray-800 mb-4">MASTER TERMS</h2>
        <p className="text-sm text-gray-500 mb-8">Last Updated: April 22, 2026</p>

        <div className="prose prose-gray max-w-none text-gray-700 space-y-6">
          <p>
            Welcome to Nine Minds! The Platform (as defined below) is owned and operated by Nine Minds LLC, a Delaware limited liability company (&ldquo;We,&rdquo; &ldquo;Us&rdquo; or &ldquo;Our&rdquo;). For purposes of these Master Terms (these &ldquo;Terms&rdquo;), &ldquo;Services&rdquo; means, collectively: (i) Our proprietary artificial intelligence platform known as &ldquo;Nine Minds&rdquo; (the &ldquo;Platform&rdquo;), which may facilitate your provision of technology related management or support services (collectively, &ldquo;Your Services&rdquo;) to your clients (&ldquo;Your Clients&rdquo;); (ii) Our website and its related domains; (iii) Our mobile applications made available through the Apple App Store, Google Play Store, or other application distribution platforms (the &ldquo;Mobile App&rdquo;); and (iv) any email notifications or other mediums, or portions of such mediums, through which you have accessed these Terms.
          </p>

          <p>
            We update these Terms from time to time. If You have an active subscription to the Platform, then We will use commercially reasonable efforts to let You know via a pop-up alerting You of the change prior to or while You are accessing Your Platform account, or by email, in Our discretion, except (1) when We launch a new service or feature, or (2) in urgent situations, such as preventing ongoing abuse or responding to legal requirements. If You do not agree to any modification or other update, then Your sole remedy will be to terminate the Agreement (and Your use of the Services, including the Platform, as a result). Your continued use of the Services (including, without limitation the Platform) following any change to these Terms is and will be deemed to be acceptance of all changes.
          </p>

          <p>
            Please read these Terms carefully. These Terms, our Privacy Policy, and any Order Form executed or assented to by You, electronically or otherwise (&ldquo;Order Form&rdquo;) collectively constitute the &ldquo;Agreement&rdquo;. You accept the Agreement by executing or assenting to the Order Form (when this option is made available to You), through use of Our Services, or by continuing to use Our Services after being notified of a change to these Terms.
          </p>

          <p className="font-bold text-sm bg-gray-50 p-4 rounded border border-gray-200">
            PLEASE BE ADVISED THAT THESE TERMS CONTAIN AN AGREEMENT TO ARBITRATE ALL CLAIMS AND DISCLAIMERS OF WARRANTIES AND LIABILITY. THESE TERMS ALSO ALLOW YOU TO PURSUE CLAIMS AGAINST US ONLY ON AN INDIVIDUAL BASIS, AND NOT AS PART OF ANY CLASS OR REPRESENTATIVE ACTION OR PROCEEDING. AS A RESULT, YOU MAY SEEK RELIEF (INCLUDING MONETARY, INJUNCTIVE AND DECLARATORY RELIEF) ONLY ON AN INDIVIDUAL BASIS. WE MAY IMMEDIATELY TERMINATE YOUR ACCESS TO THE SERVICES (IN WHOLE OR IN PART) IF YOU FAIL TO COMPLY WITH ANY PROVISION OF THESE TERMS, IF WE BELIEVE YOUR USE OF ALL OR ANY PORTION OF THE SERVICES WILL REFLECT POORLY ON US, OUR SERVICES OR OUR GOODWILL, OR IF WE OTHERWISE DEEM YOUR USE OF THE SERVICES TO BE ILLEGAL OR OTHERWISE INAPPROPRIATE, IN EACH CASE, IN OUR SOLE AND ABSOLUTE DISCRETION.
          </p>

          {/* Section 1 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">1. RELATIONSHIP OF THESE TERMS TO AN EXISTING ENTERPRISE AGREEMENT</h3>
          <p>
            If You and have entered into a separate Platform Subscription Agreement (Enterprise) with Us (an &ldquo;Existing Enterprise Agreement&rdquo;), then these Terms only apply to you to the extent that they do not conflict with that Existing Enterprise Agreement or to the extent that these Terms cover subject matter outside the scope of that Existing Enterprise Agreement. If you have not entered into an Existing Enterprise Agreement with Us, then these Terms apply to you in their entirety.
          </p>

          {/* Section 2 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">2. DESCRIPTION AND LIMITATIONS OF THE PLATFORM</h3>

          <p>
            <strong>a.</strong> The Platform is intended to facilitate your provision of Your Services to Your Clients. However, all tools, content and other materials available via the Services (including, without limitation, the Platform), including any Outputs (as defined below) resulting from Your use thereof, are for illustrative and informational purposes only, and none of them are intended to, nor should You deem them to be, recommendations or advice. While we have safeguards in place, the Services (including, without limitation, the Platform and any Outputs) may occasionally generate incorrect, incomplete and/or misleading information. As a result, You should not take an action based in whole or in part on any of the tools, content or other materials (including any Output) made available to You by the Services (including the Platform) without validating the results through independent research, obtaining up-to-date information and considering Your and/or Your Clients&apos; particular circumstances and other existing facts. We do not recommend, guarantee, or represent that the Services (including the Platform) or any information or content made available by the Services (including the Platform and any Outputs) will be accurate, complete and not misleading. Moreover, We do not warrant the performance or results that may be obtained by the use of any of the foregoing. Your use of the Services (including, without limitation, the Platform) and all tools, information, content and materials made available to You by any of the foregoing (including, without limitation, any Outputs) is at Your sole and exclusive risk. We do not have any control over your use of the Services (including, without limitation, the Platform or any Outputs) and all information, materials and other content made available to you by the Services (including, without limitation, Platform).
          </p>

          <p>
            <strong>b.</strong> You acknowledge and agree that as between You and Us: (i) You will be solely responsible for the administration of Your Services to Your Clients; (ii) the Services, including the Platform and any Outputs, do and will not in any way provide or include technical or other recommendations or advice and that you must use your independent technical judgment in determining the appropriate course of action for purposes of providing Your Services to Your Clients; and (iii) You will administer the delivery of Your Services to Your Clients based on Your own professional judgment, guidelines, policies and procedures.
          </p>

          <p className="font-bold text-sm">
            <strong>c.</strong> WE DO NOT MAKE ANY WARRANTY THAT THE SERVICES, INCLUDING PLATFORM, OR ANY RELATED SERVICES OR ANY CONTENT MADE AVAILABLE TO YOU AS THE RESULT OF ANY THEREOF (INCLUDING ANY OUTPUTS) WILL MEET YOUR OR ANY OTHER PERSON&apos;S REQUIREMENTS, INCLUDING THOSE OF YOUR CLIENTS, ACHIEVE ANY PARTICULAR RESULT, INCLUDING ANY BUG FIX, TECHNICAL WORKAROUND OR ANY OTHER PROCESS OR RESULT, BE COMPATIBLE OR WORK WITH ANY SOFTWARE, SYSTEM OR OTHER SERVICES, OR BE SECURE, ACCURATE, COMPLETE, FREE OF HARMFUL CODE OR ERROR FREE. Please carefully review Section 10(b) and Section 13 below for important disclaimers and limitations on Our liability to which you are agreeing by using the Services.
          </p>

          <p>
            <strong>d.</strong> Our Services (and the Platform in particular, if applicable) does not and is not intended to replace the need for You to maintain regular data backups or redundant data archives. WE HAVE NO OBLIGATION OR LIABILITY FOR ANY LOSS, ALTERATION, DESTRUCTION, DAMAGE, CORRUPTION, OR RECOVERY OF ANY OF YOUR MATERIALS (INCLUDING ANY RECORDS) INPUT INTO, MAINTAINED BY OR OTHERWISE AVAILABLE ON OR VIA THE SERVICES.
          </p>

          {/* Section 3 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">3. ELIGIBILITY TO USE OUR SERVICES</h3>
          <p>
            By requesting to use, registering to use and/or using our Services, you represent and warrant that you have the right, authority and capacity to enter into and agree to the Agreement (including our Privacy Policy) and you commit to abide by all of the terms and conditions hereof and thereof. You also represent and warrant that You are eighteen (18) years of age or older, and that You are not a business competitor of Ours.
          </p>

          {/* Section 4 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">4. PROVISION OF THE PLATFORM; RESTRICTIONS ON USE OF OUR SERVICES</h3>
          <p>Your access to the Platform is conditioned on your execution of or assent to an Order Form.</p>

          <p>
            <strong>a. Access to the Platform.</strong> Subject to the terms and conditions of the Agreement, in consideration of the Fees (as defined below) during the Subscription Term (as defined below), We will use commercially reasonable efforts to make the Platform available to You 24 hours a day, seven days a week, and to provide Your employees authorized by You to access the Platform (&ldquo;Authorized Users&rdquo;) with access to our standard customer support in respect of the Platform during EST business hours, in each case, except during any circumstances beyond our reasonable control or scheduled or unscheduled emergency maintenance. Authorized Users must be subject to confidentiality, use restrictions and intellectual property provisions at least as restrictive and protective of Us as those set forth in the Agreement. You and Your Authorized Users will access and use the Platform solely in connection with the lawful operation of your technology management or support services business, and in accordance with the conditions and limitations set forth in the Agreement and any Platform documentation, including any end user license agreement applicable to the Platform and/or Technology (as defined below) (&ldquo;Permitted Use&rdquo;). The authorization set forth in this paragraph is non-exclusive and non-transferable. You will be solely and exclusively responsible for any breach by Your &ldquo;Representatives&rdquo; which, for purposes of the Agreement, means Authorized Users and any other persons accessing the Platform directly or indirectly through You or Your Authorized Users. Notwithstanding anything to the contrary, You acknowledge and agree that the Platform may have defects or deficiencies that may not be corrected by Us and are subject to change at Our sole discretion.
          </p>

          <p>
            <strong>b. Restrictions on Use of the Services.</strong> You will not, and will not permit others (including any Representatives) to, directly or indirectly: (i) reverse engineer, decompile, disassemble, decode, adapt, or otherwise attempt to discover the source code, object code or underlying structure, ideas, know-how or algorithms relevant to all or any portion of the Services (including, without limitation, the Platform), including any related or underlying tool, module, software, documentation or data (collectively, &ldquo;Technology&rdquo;); (ii) modify, translate, or create derivative works of, from or otherwise based on the Services (including, without limitation, the Platform) or any Technology, in whole or in part; (iii) access and/or use the Services (including, without limitation, the Platform) or any Technology for timesharing or reselling purposes or otherwise for the benefit of a third party (other than expressly authorized by the Permitted Use); (iv) upload to or otherwise use the Services (including, without limitation, the Platform) or any Technology to store or transmit infringing, libelous, or otherwise unlawful or tortious material, or material in violation of third-party rights, including privacy rights; (v) upload to or otherwise use the Services (including, without limitation, the Platform) or any Technology to store or transmit code, files, scripts, agents or programs intended to do harm, including, for example (but not by way of limitation), viruses, worms, time bombs and Trojan horses); (vi) interfere with or disrupt the integrity or performance of the Services (including, without limitation, the Platform) or any Technology (in whole or in part); (vii) attempt to gain unauthorized access to the Services (including, without limitation, the Platform), the Technology or any of their related systems or networks, or access or use the Services (including, without limitation, the Platform) or any Technology other than by an Authorized User through the use of his or her own then valid Access Credentials (as defined below); (viii) permit direct or indirect access to or use of the Services (including, without limitation, the Platform) or any Technology in a way that circumvents a contractual usage limit; (ix) frame or mirror the whole or any part of the Services (including, without limitation, the Platform) (including any Technology); (x) access the Services (including, without limitation, the Platform) and/or the Technology (in whole or in part) in order to build a competitive product or service or for any benchmarking purposes; (xi) remove any proprietary notices or labels of or from the Services (including, without limitation, the Platform) or the Technology (in whole or in part); or (xii) access or use the Services (including, without limitation, the Platform) or any Technology in any way that violates the Agreement, any third-party rights, or any applicable laws, rules, regulations or orders having the force of law (collectively, &ldquo;Laws&rdquo;), including, without limitation, all applicable anti-spam, telemarketing, export control, privacy, and anti-terrorism laws and regulations.
          </p>

          <p>
            <strong>c. Maintenance Releases; New Features.</strong> We may from time to time make or issue updates, upgrades, releases, or other adaptations or modifications of the Platform in whole or in part (collectively, &ldquo;Maintenance Releases&rdquo;). We may also make one or more new versions, features or modules of the Platform (in whole or in part) (collectively, &ldquo;New Features&rdquo;) available to You under the terms and conditions of the Agreement. Maintenance Releases and/or any New Features made available to You (if any) will constitute a part of the Platform for purposes of the Agreement. For the avoidance of doubt, We reserve the right to offer any Maintenance Releases or New Features subject to Our then current, commercial pricing for the same. If any Maintenance Release or New Feature requires for its proper and effective use the modification of certain Platform settings, Your Content or any other accommodation, affirmative action or update on Your part (any such modification, accommodation or affirmative action on Your part, &ldquo;Accommodations&rdquo;), then We will notate such Accommodations in the relevant release note for such Maintenance Release or New Feature, if and as applicable.
          </p>

          <p>
            <strong>d. Third-Party Services.</strong> You acknowledge and agree that: (i) one or more of the features or functionalities or services available on or via the Services (including, without limitation, the Platform) may made available by third parties (&ldquo;Third-Party Service Providers&rdquo; and such functionalities or services, &ldquo;Third-Party Services&rdquo;); (ii) the Services (including, without limitation, the Platform) and/or certain features or functionalities rely on API integration for certain features and functions, but that API integration has its own inherent level of unpredictability and inconsistency that is out of Our control, and that as such We will have no liability for downtime caused by API integration failures; (iii) Third-Party Service Providers may impose restrictions on use of the particular Third-Party Service, in addition to other terms and conditions, including without limitation, those set forth in any applicable terms and conditions agreed to by or otherwise made available to You (collectively, &ldquo;Third-Party Requirements&rdquo;); (iv) You are solely responsible for compliance with, and will ensure that You and all Authorized Users comply with, all Third-Party Requirements; and (v) We may at any time terminate and/or discontinue any Third-Party Services, including as a result of termination of Our relationship with the applicable Third-Party Service Provider, provided that We will endeavor to provide You with advance written notice of any such termination or discontinuation if reasonably practical.
          </p>

          <p>
            <strong>e. No Customization of the Services.</strong> For the avoidance of doubt, other than Our standard customization options available via the internal facing portions of the Platform, We will not customize any feature, functionality, product, or other materials available on or via the Services (including, without limitation, the Platform) for You.
          </p>

          <p>
            <strong>f. Links to Third-Party Sites or Content.</strong> Links from the Services to external sites or inclusion of advertisements and other third-party content on the Services, do not constitute an endorsement by Us of such sites or the content, products, advertising and other materials presented on such sites or of the products and services that are the subject of such third-party content, but are for Our users&apos; reference and convenience. We do not control third-party sites or content, and as a result are not and will not be responsible for them. Such sites and content are governed by their respective owners&apos; terms of use and privacy policies, and not these Terms (including Our Privacy Policy). We expressly disclaim any liability derived from the use and/or viewing of such links or content that may appear on the Services, and You hereby agree to hold Us harmless from any liability that may result from the use of such links or content.
          </p>

          <div>
            <p>
              <strong>g. Mobile Application.</strong> The following additional terms apply to Your use of Our Mobile App:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-2">
              <li><strong>License.</strong> Subject to Your compliance with the Agreement, We grant You a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to download, install, and use the Mobile App on mobile devices that You own or control, solely for Your Permitted Use. This license does not allow You to distribute, make available, or use the Mobile App on any device that You do not own or control, and You may not distribute or make the Mobile App available over a network where it could be used by multiple devices at the same time.</li>
              <li><strong>Updates.</strong> We may from time to time issue updates to the Mobile App. Depending on the update, You may not be able to use the Mobile App until You have installed the latest version and accepted any new terms. The Mobile App and any updates thereto are deemed part of the Platform and Services for purposes of the Agreement.</li>
              <li><strong>Device Permissions.</strong> The Mobile App may request access to certain features or data on Your device, such as Your device&apos;s camera, photo library, file storage, and push notification services. You may grant or deny these permissions through Your device&apos;s settings. Denying certain permissions may limit the functionality of the Mobile App.</li>
              <li><strong>Biometric Authentication.</strong> The Mobile App may offer biometric authentication features (such as Face ID or fingerprint recognition) as a convenience. Biometric authentication is processed entirely on Your device using Your device&apos;s built-in capabilities. We do not collect, store, or transmit any biometric data. You are solely responsible for maintaining the security of the biometric credentials registered on Your device.</li>
              <li><strong>Push Notifications.</strong> The Mobile App may send push notifications to Your device regarding tickets, tasks, and other activity relevant to Your account. You may disable push notifications at any time through Your device&apos;s settings. See Our Privacy Policy for information about how we handle push notification tokens.</li>
              <li><strong>Content Moderation.</strong> The Mobile App lets You report objectionable content via the comment overflow menu and mute specific users so that their comments are hidden from Your view. See Section 5(f) for Our acceptable use policy, reporting process, and consequences for users who violate it.</li>
              <li><strong>Connectivity.</strong> The Mobile App requires an active internet connection to function. We are not responsible for the Mobile App&apos;s unavailability due to the absence or interruption of Your internet service or mobile data connection.</li>
              <li><strong>App Store Terms.</strong> Your download, installation, and use of the Mobile App are also subject to the terms and conditions of the application distribution platform from which You obtained it (e.g., the Apple App Store or Google Play Store). In the event of any conflict between these Terms and the applicable app store terms with respect to Your use of the Mobile App, the more restrictive terms shall govern.</li>
            </ul>
          </div>

          <div>
            <p>
              <strong>h. Apple-Specific Terms.</strong> The following terms apply if You download or use the Mobile App from the Apple App Store:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-2">
              <li>You acknowledge that these Terms are between You and Nine Minds LLC only, and not with Apple Inc. (&ldquo;Apple&rdquo;). Nine Minds LLC, not Apple, is solely responsible for the Mobile App and the content thereof.</li>
              <li>Your use of the Mobile App must comply with the Apple App Store Terms of Service.</li>
              <li>Nine Minds LLC is solely responsible for providing any maintenance and support services with respect to the Mobile App. Apple has no obligation whatsoever to furnish any maintenance and support services with respect to the Mobile App.</li>
              <li>In the event of any failure of the Mobile App to conform to any applicable warranty, You may notify Apple, and Apple will refund the purchase price (if any) for the Mobile App to You. To the maximum extent permitted by applicable law, Apple will have no other warranty obligation whatsoever with respect to the Mobile App.</li>
              <li>Nine Minds LLC, not Apple, is responsible for addressing any claims by You or any third party relating to the Mobile App or Your possession and/or use of the Mobile App, including, but not limited to: (i) product liability claims; (ii) any claim that the Mobile App fails to conform to any applicable legal or regulatory requirement; and (iii) claims arising under consumer protection, privacy, or similar legislation.</li>
              <li>In the event of any third-party claim that the Mobile App or Your possession and use of the Mobile App infringes that third party&apos;s intellectual property rights, Nine Minds LLC, not Apple, will be solely responsible for the investigation, defense, settlement and discharge of any such intellectual property infringement claim, subject to the terms of the Agreement.</li>
              <li>You represent and warrant that: (i) You are not located in a country that is subject to a U.S. Government embargo, or that has been designated by the U.S. Government as a &ldquo;terrorist supporting&rdquo; country; and (ii) You are not listed on any U.S. Government list of prohibited or restricted parties.</li>
              <li>Apple and Apple&apos;s subsidiaries are third-party beneficiaries of these Terms as they relate to Your use of the Mobile App, and upon Your acceptance of these Terms, Apple will have the right (and will be deemed to have accepted the right) to enforce these Terms against You as a third-party beneficiary thereof.</li>
            </ul>
          </div>

          {/* Section 5 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">5. YOUR RESPONSIBILITIES</h3>

          <p>
            <strong>a. Cooperation.</strong> You will cooperate with Us in all respects, including provision of information, access and support as may be reasonably required for purposes of Our performance under the Agreement. Without limiting the generality of the foregoing, You will ensure that: (i) Your Authorized Users and/or information technology team responds to Our requests for information, materials or cooperation promptly and without undue delay; and (ii) You provide Us with reasonable access to appropriate personnel, network, and systems (including, without limitation, any third party vendors and/or systems), as reasonably required for purposes of Our performance under the Agreement.
          </p>

          <p>
            <strong>b. Access Credentials.</strong> You and each Authorized User may be issued a user name, identification number, password, link, or security key, security token, PIN or other security code, method, technology or device used, alone or in combination, to verify an individual&apos;s identity and authorization to access and use the Platform (&ldquo;Access Credentials&rdquo;). Access Credentials include, without limitation, biometric authentication methods (such as Face ID or fingerprint recognition) configured on Your device to secure access to the Mobile App. You will ensure that Your Authorized Users use strong Access Credentials (i.e., in the case of a password, one that is long, uses a mix of letters (upper and lower case), numbers and symbols, has no ties to the Authorized User&apos;s personal information, and no dictionary words) even if the Platform permits simple Access Credentials. You have and will retain sole responsibility for the security and use of all Access Credentials, including for any losses that You or any third party may suffer as a result of the authorized or unauthorized use of any Access Credentials by any third party. We reserve the right to disable any Access Credentials at any time in Our discretion for any or no reason, including (without limitation) if, in Our opinion, You or any of Your Authorized Users has violated any provision of the Agreement.
          </p>

          <p>
            <strong>c. Your Systems; Technical Requirements.</strong> You and each of Your Authorized Users will and are responsible for: (i) obtaining and maintaining any equipment and ancillary services needed to connect to, access or otherwise use the Services (including, without limitation, the Platform), including, without limitation, modems, hardware, servers, software, operating systems, networking, web servers, mobile devices and the like (collectively, &ldquo;Your Systems&rdquo;); (ii) maintaining the security of all of Your Systems; (iii) all uses of Your account(s) or Your Systems by Your Representatives; and (iv) acquiring any third party rights, licenses and/or consents necessary to connect to, integrate with, access or otherwise use the Services (including, without limitation, the Platform) or any feature, functionality or tool thereof, in whole or in part. You acknowledge and agree that failure to obtain and maintain Your Systems, to meet any applicable technical requirements of or relating to the Services (including, without limitation, the Platform), or to obtain any necessary third-party rights, licenses and/or consents, may cause the Services (including, without limitation, the Platform) to (in whole or in part) be unavailable, or function ineffectively or inappropriately. We will in no event be responsible for any downtime, losses, failures or liabilities that arise as a result of Your failure comply with the requirements set forth in this Section. You acknowledge that use of the Services (including, without limitation, the Platform) requires one or more compatible devices (messaging rates may apply), Internet access (fees may apply), and certain software (fees may apply), and may require obtaining updates or upgrades from time to time. High speed Internet access is recommended. You acknowledge and agree that the compliance with the requirements set forth in this Section, which may be changed from time to time, are Your responsibility.
          </p>

          <p>
            <strong>d. Your Materials.</strong> You will ensure (and represent, warrant and covenant) that Your Services and all other information, content or other materials provided by You or Your Authorized Users to Us via the Services (including, without limitation, the Platform) or otherwise pursuant to the Agreement (collectively, &ldquo;Your Materials&rdquo;) as well as Your activities in connection with, use of or access to the Services (including, without limitation, the Platform) are accurate, complete and do not and will not violate any Laws or infringe on a third party&apos;s intellectual property or other rights. You will be solely and completely responsible for the accuracy, quality and legality of any and all of Your Materials, the means by which You acquired Your Materials, and the use of the same by You and Your Representatives. Without limiting the generality of the foregoing, if Your Materials include any personal information or proprietary or otherwise confidential information of or in respect of Your Clients, You will ensure that Your and Your Representatives&apos; collection and submission into the Services (including, without limitation, the Platform) of the same, and Your, Your Representatives&apos; and Our use and storage of the same as contemplated by the Agreement does not violate any third party rights (including, without limitation, any privacy rights and/or any contractual obligations to Your Clients or any other third parties), and otherwise complies with Laws, including, without limitation, any Laws relating to the consent of or disclosure to consumers with respect to the collection, use or disclosure of such information as contemplated by the Agreement. If We receive information indicating or otherwise reasonably believe that all or any portion of any Your Materials or use of the Services (including, without limitation, the Platform) in connection therewith may violate Laws, any third-party rights or otherwise could reflect poorly on Us or negatively impair Our goodwill (in each case, in Our sole and absolute discretion), We may so notify You and, if You fail to remove or modify the relevant portion of Your Materials from the Services (including, without limitation, the Platform) within two business days, We may delete the relevant portion of Your Materials from the same. Under no circumstances will We be liable in any way for any: (i) of Your Materials transmitted or viewed while using the Services (including, without limitation, the Platform); (b) errors or omissions in Your Materials; or (c) any loss or damage of any kind incurred as a result of the use of, access to, or denial of access to any of Your Materials.
          </p>

          <p>
            <strong>e. Compliance with Laws.</strong> You acknowledge and agree that the Services (including, without limitation, the Platform) do not guaranty Your compliance with applicable Laws, including, without limitation, Laws relating to privacy of consumer information, and that Your compliance with applicable Laws is ultimately Your sole and exclusive responsibility. Without limiting the generality of the foregoing, You acknowledge that We do not and will not provide any legal or technical advice, and that any feedback, content, output or materials provided by Us or the Services (including, without limitation, the Platform) as part of or in connection with the Services (including, without limitation, the Platform) (including any support thereof) do not constitute legal or other professional advice, and that You are solely responsible for determining the legality, validity and enforceability of all of Your Materials, Your use of the Services (including, without limitation, the Platform), Your Services, and the accuracy, accessibility, safety and reliability of any language contained within all of Your Materials and/or Your Services.
          </p>

          <p>
            <strong>f. Objectionable Content; Reporting Abuse.</strong> We have zero tolerance for objectionable content or abusive behavior on the Services, including in the Mobile App. You will not upload, post, transmit, or otherwise make available any content that is unlawful, harassing, threatening, defamatory, obscene, hateful, that depicts or encourages violence, that sexualizes minors, or that infringes any third party&apos;s intellectual property or privacy rights. You will not use the Services to harass, stalk, impersonate, or abuse any other person. If You encounter content or user behavior that violates this policy, You may: (i) use the in-app &ldquo;Report&rdquo; action on the affected comment (Mobile App); or (ii) email{' '}
            <a href="mailto:abuse@nineminds.com" className="text-primary-600 hover:underline">abuse@nineminds.com</a>
            {' '}with details. We will review reports and take appropriate action in Our sole discretion, which may include removing content, restricting Your or any Representative&apos;s use of features, and suspending or terminating access to the Services for any user or account We determine has violated this policy. The Mobile App also provides a mute feature that lets You hide a specific user&apos;s comments from Your own view; muting is applied only to Your device and does not affect other users. This Section 5(f) supplements, and does not limit, any other provision of these Terms.
          </p>

          {/* Section 6 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">6. TERM AND TERMINATION</h3>

          <p>
            <strong>a. Subscription Term.</strong> If You have an active subscription to the Platform, then subject to earlier termination as provided below, the Agreement is for the term specified in the Order Form and will automatically renew for additional periods of the same duration (collectively, the &ldquo;Subscription Term&rdquo;), unless sooner terminated as set forth in the Order Form or these Terms.
          </p>

          <p>
            <strong>b. Other Terms of Access.</strong> If You do not have an active subscription to the Platform, then You acknowledge and agree that We reserve the right, in Our sole discretion, to immediately terminate Your access to all or part of the Services, and/or to terminate your account with Us, with or without notice for any reason or no reason in Our sole discretion, including, without limitation, if We determine that You are not eligible to use the Services or have violated the Agreement. You may terminate Your use of portions of the Services other than the Platform at any time by actually terminating such use, in which case, the Agreement will be deemed terminated as to such aspects of the Services.
          </p>

          <div>
            <p><strong>c. Termination of Subscription Term</strong></p>
            <p className="ml-4">
              <strong>i.</strong> You may terminate the Subscription Term at any time by following the instructions on Your account setting page. If You cancel a paid subscription, You typically will be permitted to use Your subscription until the end of your then-current subscription term. Your paid subscription will not be renewed after Your then-current term expires, but Your payment method will be charged, and You will be required to pay, any cancellation or other fees associated with your early termination and disclosed to You at the time you signed up for the subscription plan.
            </p>
            <p className="ml-4">
              <strong>ii.</strong> We may terminate the Subscription Term: (i) by providing You with notice of Our intention to not renew at least 30 days&apos; prior to the end of the then-current Term; (ii) immediately, by providing You with written notice, if You are in material breach of the Agreement that is not capable of cure (as determined by Us in Our sole discretion) or (if capable of cure) is not cured within fifteen (15) days of receipt of written notice of such breach; (iii) upon written notice, if You become the subject of a petition in bankruptcy or any other proceeding relating to insolvency, receivership, liquidation or assignment for the benefit of creditors; (iv) immediately, by providing You with written notice, if We believe Your use of all or any portion of the Platform will reflect poorly on Us, the Platform, Our other service offerings, or our goodwill, or if we otherwise deem your use of the Platform to be illegal or otherwise inappropriate, in each case, in our sole and absolute discretion; and (v) as otherwise expressly set forth in the Agreement.
            </p>
          </div>

          <p>
            <strong>d. Effect of Termination.</strong> On termination of the Subscription Term and/or of the Agreement for any reason: (i) You will pay all applicable Fees for access to the Services provided up to and including the effective date of termination; (ii) You will within 14 days of the effective date of termination return or certify the permanent destruction of all of Our Confidential Information (as defined below) in Your possession or under Your control; and (iii) You will delete the Mobile App from all of Your devices. All sections of the Agreement which by their nature should survive termination will survive termination, including, without limitation, accrued rights to payment, confidentiality obligations, warranty disclaimers, and limitations of liability.
          </p>

          <p>
            <strong>e. Suspension of Access.</strong> We may, directly or indirectly and by any lawful means (including any disabling device), suspend or otherwise deny Your or any Representative&apos;s access to or use of all or any part of the Services (including, without limitation, the Platform) without incurring any resulting obligation or liability, if: (i) You fail to pay any amount when due under the Agreement, and such failure continues for five (5) days or more after the relevant due date; (ii) We believe, in Our sole and absolute discretion, that You or any Representative: (x) have failed to comply with any term of the Agreement; (y) have accessed or used the Services (including, without limitation, the Platform) beyond the scope of the authorization granted or for a purpose not authorized or intended under the Agreement or in any manner that does not comply with any of Our instructions or requirements; or (z) are, have been, or are likely to be involved in any fraudulent, misleading, unlawful or unethical activities, or in any activity that could reflect poorly on Us or negatively impair Our goodwill (in each case, in Our sole and absolute discretion); (iii) the Subscription Term is terminated or expires; (iv) We deem it necessary or desirable in order to prevent, mitigate or address a material security issue; or (v) We receive a judicial or other governmental demand or order, subpoena, or law enforcement request that expressly or by reasonable implication requires Us to do so. This paragraph does not limit any of Our other rights or remedies whatsoever, including any rights or remedies at law, in equity or under the Agreement.
          </p>

          <p className="font-bold text-sm">
            <strong>f. No Refunds.</strong> EXCEPT AS EXPRESSLY SET FORTH IN THE APPLICABLE ORDER FORM, ALL PAYMENTS OF FEES ARE NON-REFUNDABLE, AND THERE ARE NO REFUNDS OR CREDITS FOR UNUSED OR PARTIALLY USED SUBSCRIPTIONS, EVEN IF YOU CANCEL YOUR SUBSCRIPTION IN THE MIDDLE OF THE SUBSCRIPTION TERM.
          </p>

          {/* Section 7 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">7. FEES AND PAYMENT</h3>

          <p>
            <strong>a. Fees.</strong> You will pay Us applicable fees as described in the Order Form (the &ldquo;Fees&rdquo;). Unless otherwise set forth in the Order Form, all invoiced amounts are due within five (5) days of the invoice date.
          </p>

          <p>
            <strong>b. Payment Terms.</strong> You agree that We (and/or our third-party payment processor) may charge to Your bank account or other payment mechanism selected by You and approved by Us all amounts due and owing hereunder, including taxes and service fees, subscription fees, or any other fee or charge associated with Your account with Us. You will pay all Fees in US Dollars by credit card, ACH or wire or other electronic transfer of immediately available funds. All amounts payable to Us under the Agreement will be paid by You in full without setoff or withholding for any reason or other than a deduction or withholding of tax as may be required by applicable Law. Undisputed unpaid amounts (and disputed amounts ultimately determined to be payable to Us) are subject to a finance charge of 1.5% per month on any outstanding balance, or the maximum permitted by Law, whichever is lower. In the event We are unable to collect amounts You owe to Us hereunder, We may take any other steps We deem necessary to collect, and You will be responsible for all costs and expenses incurred by Us in connection with such collection activity, including collection fees, court costs and attorneys&apos; fees.
          </p>

          <p>
            <strong>c. Changes to Fees.</strong> We may increase Fees at any time and from time to time, provided that the subscription Fees for the Platform will be as set forth in the applicable Order Form for the initial term. Unless otherwise agreed to in writing by the parties, following the initial term, subscription Fees will be at Our then-current commercial rates, and Your continued use of the Platform will constitute Your acceptance of such Fees.
          </p>

          <p>
            <strong>d. Taxes.</strong> Fees do not include any taxes, levies, duties or similar governmental assessments of any nature, including, for example, value-added, sales, use or withholding taxes, assessable by any jurisdiction whatsoever (collectively, &ldquo;Taxes&rdquo;). You will be responsible for all Taxes associated with Your purchase of access to the Services (including, without limitation, the Platform), other than U.S. taxes based on Our income.
          </p>

          <p>
            <strong>e. Future Functionality.</strong> You acknowledge and agree that Your entrance into the Agreement is not contingent on the delivery of any future functionality or features of the Services (including, without limitation, the Platform), or dependent on any oral or written public comments made by Us regarding any such future functionality or features unless otherwise noted on the Order Form.
          </p>

          <p>
            <strong>f. Free-Trial Offers.</strong> We may from time to time make all or certain portions of the Platform available at no charge (&ldquo;Freemium Subscriptions&rdquo;). If You register for one or more Freemium Subscriptions, You acknowledge and agree that You may have limited access to the Platform and/or features thereof. See Section 17 for additional terms and conditions applicable to Freemium Subscriptions.
          </p>

          {/* Section 8 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">8. OWNERSHIP AND LICENSES</h3>

          <p><strong>a. Ownership.</strong></p>

          <p className="ml-4">
            <strong>i.</strong> You (or Your licensors, as applicable) will own all right, title and interest in and to Your Materials (including Your Marks, as defined below), as well as in and to any output generated by the Platform and provided to Your Authorized Users in response to Your submission Your Materials (&ldquo;Outputs&rdquo;). Subject to Your compliance with the Agreement, We hereby assign to You all of the rights We may have in any Outputs. For the avoidance of doubt, You are solely and absolutely responsible for all Outputs, including for verifying the accuracy, completeness or appropriateness of the same. See Section 2 and Section 10(b) for further information.
          </p>

          <p className="ml-4">
            <strong>ii.</strong> We or Our licensors will own and retain all right, title and interest in and to the following (collectively, &ldquo;Our Property&rdquo;): (i) the Services (including, without limitation, the Platform), the Technology, and all improvements, enhancements or modifications to any of the foregoing; (b) any work product, including any software, applications, inventions or other technology or intellectual property developed, authored and/or reduced to practice in connection with Our making the Services (including, without limitation, the Platform) available to You, including as the result of any support provided to You (&ldquo;Results&rdquo;) (excluding, for the avoidance of doubt, any Outputs); (c) the &ldquo;Managed Minds&rdquo; name, brand, marks and other similar intellectual property; (d) any suggestion, enhancement request, recommendation, correction or other feedback provided by You or Your Representatives relating to the subject matter of the Agreement (collectively, &ldquo;Feedback&rdquo;), as well as any improvements, enhancements or other modifications created, prepared, produced, authored, edited, amended, conceived or reduced to practice by Us (whether alone or together with You or any other third party or parties) arising out of or relating to such Feedback; (e) any and all performance data, test or evaluation results, or other metrics derived from the Services (including, without limitation, the Platform), including Aggregated Data (as defined below); and (f) all intellectual property rights related to any of the foregoing. We expressly reserve all other rights in and to the foregoing. During and after the term of the Agreement (including any Subscription Term), each party will cooperate with the other to do any and all things which reasonably necessary or desirable to establish, maintain, protect and enforce a party&apos;s exclusive ownership of the property identified in this Section.
          </p>

          <p>
            <strong>b. Use of Data.</strong> Notwithstanding anything to the contrary, and to the extent not prohibited by Law, We will have the right to collect and analyze Your Materials and other information relating to the provision, use and performance of various aspects of the Services (including, without limitation, the Platform) and Technology (including, without limitation, Your Materials, all Platform Outputs, and data derived from any thereof), and will be free (during and after the term of the Agreement, including any Subscription Term) to: (i) use such information and data to improve and enhance the Services (including, without limitation, the Platform) (in whole or in part) and for other development, diagnostic and corrective purposes in connection with the Services (including, without limitation, the Platform), the Technology and/or Our other product or service offerings; and (ii) use and disclose such information and data solely in aggregate or other de-identified form in connection with Our business without disclosing Your identity, or the identity of any of Your Clients or Your individual Authorized Users (&ldquo;Aggregated Data&rdquo;). No rights or licenses are granted except as expressly set forth herein.
          </p>

          <p>
            <strong>c. License.</strong> If you are accessing these Terms on behalf of an entity, you grant us a worldwide, royalty-free, license to use, publish and display such entity&apos;s name, trade name, brand, service mark, and image (collectively, &ldquo;Marks&rdquo;) in connection with our marketing efforts of the Platform.
          </p>

          {/* Section 9 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">9. CONFIDENTIALITY</h3>

          <p>
            <strong>a. Confidential Information.</strong> &ldquo;Confidential Information&rdquo; means any and all confidential or proprietary information of the Disclosing Party (as defined below) or of a third party and held by the Disclosing Party on a confidential basis, including, without limitation, protected health information, documents, reports, analyses, data, studies, drawings, samples, suppliers, customers, pricing, pricing techniques, copyright, trademark and patent applications, marketing and sales techniques and plans, projections, technology, methods, procedures, software (including all documentation and code), hardware and system designs, architectures and protocols, trade secrets, know-how, and observations, whether disclosed orally or in writing, whether or not marked as &ldquo;confidential,&rdquo; and whether disclosed or made available to the Receiving Party before, on or after the date of the Agreement. Our Confidential Information includes Our Property and the terms, but not the existence of, the Agreement. Your Confidential Information includes non-public data provided by You or Your Authorized Users to Us or via the Platform. &ldquo;Disclosing Party&rdquo; means the party disclosing or making available the Confidential Information. &ldquo;Receiving Party&rdquo; means the party receiving or accessing the Confidential Information.
          </p>

          <p>
            <strong>b. Exclusions from Confidential Information.</strong> The term &ldquo;Confidential Information&rdquo; does not include information that, as evidenced by the Receiving Party with written documentation: (i) is or becomes publicly available after disclosure to the Receiving Party without breach of any obligation owed to the Disclosing Party or any third party; (ii) was lawfully received by the Receiving Party from a third party without obligation of confidentiality owed to the Disclosing Party or any third party; (iii) was known to the Receiving Party prior to its receipt from the Disclosing Party without obligation of confidentiality owed to the Disclosing Party or any third party; or (iv) was independently developed by the Receiving Party without use or reference to Confidential Information and without breach of the Agreement.
          </p>

          <p>
            <strong>c. Confidentiality Obligations.</strong> The Receiving Party will: (i) use commercially reasonable efforts to safeguard Confidential Information from unauthorized use, access, or disclosure using at least the degree of care it uses to protect its similarly sensitive information and in no event less than a reasonable degree of care; (ii) use Confidential Information for the sole purpose of performing its obligations or exercising its rights under the Agreement (and in Our case, as otherwise set forth in these Terms and Our Privacy Policy); and (iii) restrict disclosure of Confidential Information to those of its officers, directors, employees, professional advisors, contractors, agents and representatives with a need to know such information for the sole purpose of performing its obligations or exercising its rights under the Agreement (and in Our case, as otherwise set forth in these Terms and Our Privacy Policy).
          </p>

          {/* Section 10 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">10. REPRESENTATIONS AND WARRANTIES; DISCLAIMER</h3>

          <p>
            <strong>a. Representations.</strong> We will: (i) use commercially reasonable efforts consistent with prevailing industry standards to perform and maintain the Platform in a manner which minimizes errors and interruptions in the Platform; and (ii) provide support services (if any) in a professional and workmanlike manner. In the event of a breach by Us of the foregoing, Your sole remedy will be to exercise Your termination rights hereunder.
          </p>

          <div>
            <p className="font-bold text-sm">
              <strong>b. Disclaimer.</strong> EXCEPT AS EXPRESSLY SET FORTH IN SECTION 10(a), THE SERVICES, INCLUDING, WITHOUT LIMITATION, THE PLATFORM, THE TECHNOLOGY AND ALL TOOLS, CONTENT AND OTHER MATERIALS AVAILABLE VIA THE SERVICES, INCLUDING ANY OUTPUT RESULTING FROM YOUR USE THEREOF) ARE PROVIDED ON AN &ldquo;AS IS&rdquo; BASIS AND WE EXPRESSLY DISCLAIM ALL WARRANTIES, EXPRESS, IMPLIED, STATUTORY OR OTHER, INCLUDING, BUT NOT LIMITED TO, IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE AND NON-INFRINGEMENT, AND ANY AND ALL WARRANTIES ARISING FROM COURSE OF DEALING, USAGE OR TRADE PRACTICE WITH RESPECT TO THE SAME. Without limiting the generality of the foregoing:
            </p>
            <p className="ml-4 font-bold text-sm">
              <strong>i.</strong> WE DO NOT WARRANT THE ACCURACY, ADEQUACY OR COMPLETENESS OF ANY CONTENT AVAILABLE ON, THROUGH OR AS A RESULT OF THE SERVICES (INCLUDING THE PLATFORM AND ANY OUTPUTS THEREFROM) AND HEREBY EXPRESSLY DISCLAIM ANY LIABILITY FOR ERRORS OR OMISSIONS IN SUCH CONTENT. ALL TOOLS, CONTENT AND OTHER MATERIALS AVAILABLE VIA THE SERVICES, INCLUDING THE PLATFORM AND ANY OUTPUT RESULTING FROM YOUR USE THEREOF, ARE FOR ILLUSTRATIVE AND INFORMATIONAL PURPOSES ONLY, AND NONE OF THEM ARE INTENDED TO, NOR SHOULD YOU DEEM THEM TO BE, RECOMMENDATIONS OR ADVICE. WHILE WE HAVE SAFEGUARDS IN PLACE, THE SERVICES, INCLUDING, WITHOUT LIMITATION, THE PLATFORM AND ANY OUTPUTS, MAY OCCASIONALLY GENERATE INCORRECT, INCOMPLETE AND/OR MISLEADING INFORMATION. WE DO NOT RECOMMEND, GUARANTEE, OR REPRESENT THAT THE SERVICES (INCLUDING, WITHOUT LIMITATION, THE PLATFORM) OR ANY INFORMATION OR CONTENT MADE AVAILABLE BY THE SERVICES (INCLUDING THE PLATFORM AND ANY OUTPUTS THEREFROM) WILL BE ACCURATE, COMPLETE AND NOT MISLEADING. MOREOVER, WE DO NOT WARRANT THE PERFORMANCE OR RESULTS THAT MAY BE OBTAINED BY THE USE OF ANY OF THE FOREGOING. YOUR USE OF THE SERVICES, INCLUDING THE PLATFORM AND ALL TOOLS, INFORMATION, CONTENT AND MATERIALS MADE AVAILABLE TO YOU BY THE SERVICES (INCLUDING THE PLATFORM AND ANY OUTPUTS) IS AT YOUR SOLE AND EXCLUSIVE RISK.
            </p>
            <p className="ml-4 font-bold text-sm">
              <strong>ii.</strong> WE DO NOT MAKE ANY WARRANTY THAT THE SERVICES, INCLUDING PLATFORM, OR ANY RELATED SERVICES OR ANY CONTENT MADE AVAILABLE TO YOU AS THE RESULT OF ANY THEREOF (INCLUDING ANY OUTPUTS) WILL MEET YOUR OR ANY OTHER PERSON&apos;S REQUIREMENTS, INCLUDING THOSE OF YOUR CLIENTS, ACHIEVE ANY PARTICULAR RESULT, INCLUDING ANY BUG FIX, TECHNICAL WORKAROUND OR ANY OTHER PROCESS OR RESULT, BE COMPATIBLE OR WORK WITH ANY SOFTWARE, SYSTEM OR OTHER SERVICES, OR BE SECURE, ACCURATE, COMPLETE, FREE OF HARMFUL CODE OR ERROR FREE.
            </p>
            <p className="ml-4">
              <strong>iii.</strong> You acknowledge that the Services may in whole or in part be temporarily unavailable for scheduled maintenance or for unscheduled emergency maintenance, either by Us or by third-party providers, or because of other causes beyond Our reasonable control. If you have an active subscription to the Platform, We will use commercially reasonable efforts to provide advance notice by e-mail of any scheduled service disruption to the Platform and to reinstate the Platform. HOWEVER, WE DO NOT WARRANT THAT ACCESS TO THE SERVICES, INCLUDING, WITHOUT LIMITATION, THE PLATFORM, WILL BE UNINTERRUPTED OR ERROR FREE.
            </p>
            <p className="ml-4 font-bold text-sm">
              <strong>iv.</strong> ALL THIRD-PARTY SERVICES INCLUDED IN THE SERVICES (INCLUDING THE PLATFORM AND ANY RELATED SERVICES) ARE PROVIDED &ldquo;AS IS&rdquo; AND SUBJECT TO ANY APPLICABLE THIRD-PARTY SERVICE PROVIDER TERMS AND CONDITIONS. ANY REPRESENTATION OR WARRANTY OF OR CONCERNING ANY THIRD-PARTY SERVICES IS STRICTLY BETWEEN YOU AND THE THIRD-PARTY SERVICE PROVIDER.
            </p>
          </div>

          {/* Section 11 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">11. INDEMNIFICATION</h3>
          <p>
            You will indemnify, defend and hold Us harmless from and against any and all claims, losses, damages, judgments, liabilities costs, and expenses (including attorneys&apos; fees and the costs of enforcing this provision and of pursuing any insurance providers) arising from or relating to: (i) any of Your Materials, including any use, disclosure or storage of the same by Us or on Our behalf in accordance with the Agreement; (ii) Our compliance with any specifications or directions provided by You or your Representatives or on Your their respective behalf&apos;s; (iii) Your failure to comply with any applicable Laws, or any of Your other obligations, covenants, representations and warranties set forth in the Agreement; or (iv) Your or any of Your Authorized Users&apos; access or use of the Services (including, without limitation, the Platform).
          </p>

          {/* Section 12 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">12. INFRINGEMENT MITIGATION</h3>

          <p>
            <strong>a.</strong> If you have an active subscription to the Platform and all or any portion of the Platform is, or in Our opinion is likely to be, claimed to infringe misappropriate, or otherwise violate any third-party intellectual property right, or if Your use of the Platform is in whole or in part enjoined or threatened to be enjoined, then We may, at Our option and sole cost and expense: (a) replace or modify the Platform (in whole or in part) so as to make the Platform (as replaced or modified) non-infringing, while providing substantially similar features and functionality, and in which case such replacements or modifications will constitute a part of the Platform for purposes of the Agreement; (b) obtain for You a right to continue using the Platform as materially contemplated by the Agreement; or (c) if neither of the foregoing is commercially practicable in Our sole discretion, terminate the term of the Agreement, including any Subscription Term (or Your rights to access and use the infringing component of the Services) and provide You with a refund of any prepaid, unused fees for the Services or the infringing component, as applicable.
          </p>

          <p>
            <strong>b.</strong> Additionally, if you have an active subscription to the Platform, then We will defend You against any third-party claims brought against You alleging that Your or an Authorized User&apos;s use of the Platform in accordance with the Agreement infringes or misappropriates such third party&apos;s patents, copyrights, or trade secrets, and will indemnify You against all damages finally and actually paid as part of a final judgment or settlement thereof. The foregoing obligation does not apply to the extent the alleged infringement arises out of or relates to: (i) Your Materials or Third-Party Services; (ii) modification of the Platform other than by Us; (iii) access or use of the Platform in combination with any hardware, system, software, network, or other materials or service not provided by Us; (iv) Your failure to timely implement any modifications, upgrades, replacements, or enhancements made available to You by Us or on Our behalf and/or to make any Accommodations; or (v) any act, omission or other matter described in Section 11.
          </p>

          <p className="font-bold text-sm">
            <strong>c.</strong> THIS SECTION 12 SETS FORTH YOUR SOLE REMEDY AND OUR SOLE LIABILITY AND OBLIGATION FOR ANY ACTUAL, THREATENED, OR ALLEGED CLAIMS THAT THE SERVICES (INCLUDING, WITHOUT LIMITATION, THE PLATFORM), OR ANY TECHNOLOGY OR RELATED SERVICES OR OTHER MATERIALS PROVIDED BY OR MADE AVAILABLE BY US UNDER THE AGREEMENT INFRINGES, MISAPPROPRIATES, OR OTHERWISE VIOLATES ANY INTELLECTUAL PROPERTY RIGHTS OF ANY THIRD PARTY.
          </p>

          {/* Section 13 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">13. LIMITATION ON LIABILITY; MUTUAL WAIVER OF CLASS ACTION PARTICIPATION</h3>

          <p className="font-bold text-sm">
            <strong>a.</strong> IN NO EVENT WILL WE OR ANY OF OUR LICENSORS, SERVICE PROVIDERS OR SUPPLIERS BE LIABLE UNDER OR IN CONNECTION WITH THE AGREEMENT OR ITS SUBJECT MATTER UNDER ANY LEGAL OR EQUITABLE THEORY, INCLUDING BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY AND OTHERWISE, FOR ANY: (i) LOSS OF PRODUCTION, USE, BUSINESS, REVENUE OR PROFIT OR DIMINUTION IN VALUE; (ii) IMPAIRMENT, INABILITY TO USE OR LOSS, INTERRUPTION OR DELAY OF THE SERVICES, INCLUDING, WITHOUT LIMITATION, THE PLATFORM (IN WHOLE OR IN PART); (iii) LOSS, DAMAGE, CORRUPTION OR RECOVERY OF DATA, OR BREACH OF DATA OR SYSTEM SECURITY; OR (iv) CONSEQUENTIAL, INCIDENTAL, INDIRECT, EXEMPLARY, SPECIAL, ENHANCED OR PUNITIVE DAMAGES, IN EACH CASE, REGARDLESS OF WHETHER SUCH PERSONS WERE ADVISED OF THE POSSIBILITY OF SUCH LOSSES OR DAMAGES OR SUCH LOSSES OR DAMAGES WERE OTHERWISE FORESEEABLE, AND NOTWITHSTANDING THE FAILURE OF ANY AGREED OR OTHER REMEDY OF ITS ESSENTIAL PURPOSE.
          </p>

          <p className="font-bold text-sm">
            <strong>b.</strong> IN NO EVENT WILL THE COLLECTIVE AGGREGATE LIABILITY OF OURS AND OUR LICENSORS, SERVICE PROVIDERS AND SUPPLIERS UNDER OR IN CONNECTION WITH THE AGREEMENT OR ITS SUBJECT MATTER, UNDER ANY LEGAL OR EQUITABLE THEORY, INCLUDING BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY AND OTHERWISE, EXCEED THE AMOUNTS PAID BY YOU TO US UNDER THE AGREEMENT DURING THE TWELVE-MONTH PERIOD IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM. THE FOREGOING LIMITATION APPLIES NOTWITHSTANDING THE FAILURE OF ANY AGREED OR OTHER REMEDY OF ITS ESSENTIAL PURPOSE.
          </p>

          <p className="font-bold text-sm">
            <strong>c.</strong> Neither We nor You may be a representative of other potential claimants or a class of potential claimants in any dispute concerning or relating to the Agreement, nor may two or more individuals&apos; disputes be consolidated or otherwise determined in one proceeding. WE AND YOU ACKNOWLEDGE THAT THIS SECTION WAIVES ANY RIGHT TO PARTICIPATION AS A PLAINTIFF OR AS A CLASS MEMBER IN ANY CLASS ACTION.
          </p>

          {/* Section 14 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">14. FORCE MAJEURE</h3>
          <p>
            Except for a party&apos;s obligations to pay Fees, each party will be excused from performance of its obligations for any period and the time of performance will be extended as reasonably necessary under the circumstances, to the extent that such party is prevented from performing, in whole or in part, its obligations under the Agreement, as a result of acts of God, any governmental authority, war, pandemic, epidemic, health crisis, government order or lockdown, civil disturbance, court order, labor dispute or any other cause beyond its reasonable control, including, in Our case, Third Party Service malfunctions (such as interruption of Third Party Service services or functions) hurricanes, inclement weather, and failures or fluctuations in electrical power, heat, light, telecommunication equipment or lines or any other equipment or network outside of Our reasonable control.
          </p>

          {/* Section 15 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">15. NOTICES</h3>
          <p>
            All notices, demands, requests or other communications which may be or are required to be given, served, or sent by a party to the other party pursuant to the Agreement will be in writing and will be delivered electronically to the email addresses set forth below. Either party may change its email address for notice by notifying the other parties of such change in accordance with this Section.
          </p>
          <p><strong>If to You:</strong> to the email address set forth on the Order Form.</p>
          <p><strong>If to Us:</strong> to the email address set forth on the Order Form, marked to the Attention of &ldquo;Legal Notice,&rdquo; and in all cases, with copy (but which will not constitute notice) to legal@nineminds.com.</p>

          {/* Section 16 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">16. GOVERNING LAW; VENUE</h3>
          <p>
            The Agreement will be governed by, and construed and enforced in accordance with, the laws of the State of Florida without regard to conflict of law principles. Neither any adoption of the Uniform Computer Information Transactions Act nor the U.N. Convention on the International Sale of Goods applies to the Agreement or to the rights or duties of the parties under the Agreement. Any dispute arising out of or relating to the Agreement, or its subject matter will be brought solely and exclusively in the courts of record of the State of Florida in Hillsborough County, Florida or the United States District Court, Middle District of Florida, Tampa Division, and each party consents to the exclusive jurisdiction of such court in any such civil action or legal proceeding and waives any objection to the laying of venue of any such civil action or legal proceeding in such court. Each party irrevocably and unconditionally waives any right it may have to a trial by jury in respect of any legal action arising out of or relating to the Agreement or the transactions contemplated thereby.
          </p>

          {/* Section 17 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">17. FREEMIUM SUBSCRIPTIONS</h3>
          <p>
            Notwithstanding anything to the contrary in the Agreement, You acknowledge that Freemium Subscriptions may be provided for evaluation or other related purposes and, therefore, may contain bugs or errors, and will be subject to additional terms (including those set forth below).
          </p>

          <p>
            <strong>a.</strong> We may discontinue Freemium Subscriptions (in whole or in part) at any time in Our sole discretion and may never make them generally available.
          </p>

          <p>
            <strong>b.</strong> We may provide customer support in respect of Freemium Subscriptions in Our commercially reasonable discretion. Without limiting the generality of the foregoing, We make no promises or guarantees to provide customer support or if provided, any particular level of customer support, with respect to any Freemium Subscriptions.
          </p>

          <p className="font-bold text-sm">
            <strong>c.</strong> Our entire liability to You, and Your sole remedy in connection with any Freemium Subscription (including, without limitation, any defects or non-performance of any Freemium Subscription) is for You to terminate Your use of the Freemium Subscription. WITHOUT LIMITING THE APPLICATION OF ANY OTHER LIMITATIONS OF LIABILITY APPLICABLE TO YOUR USE OF THE PLATFORM OR ANY RELATED SERVICES PROVIDED BY US HEREUNDER, IN NO EVENT WILL THE COLLECTIVE AGGREGATE LIABILITY OF OURS AND OUR LICENSORS, SERVICE PROVIDERS AND SUPPLIERS UNDER OR IN CONNECTION WITH ANY FREEMIUM SUBSCRIPTION, UNDER ANY LEGAL OR EQUITABLE THEORY, INCLUDING BREACH OF CONTRACT, TORT (INCLUDING NEGLIGENCE), STRICT LIABILITY AND OTHERWISE, EXCEED $25.00. THE FOREGOING LIMITATION APPLIES EVEN IF ANY REMEDY FAILS OF ITS ESSENTIAL PURPOSE.
          </p>

          {/* Section 18 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">18. MISCELLANEOUS</h3>
          <p>
            You may not assign the Agreement without Our prior written consent; provided, however, that You may assign the Agreement to a third party who/which is not a competitor to Us and who/which is acquiring all or substantially all of Your equity interests or assets without Our prior written consent (subject to Your provision to Us of written notice of such acquisition as soon as reasonably practical upon the closing of such acquisition). No delay or omission by Us to exercise any right or power under the Agreement will impair any such right or power or be construed as a waiver thereof. A waiver by Us in any one instance of any of the covenants, conditions or agreements to be performed by You will not be construed as a waiver with respect to any succeeding instance in which the same provision may apply. We update these Terms from time to time. If You have an active subscription to the Platform, then We will use commercially reasonable efforts to let You know via a pop-up alerting You of the change prior to or while You are accessing Your Platform account, or by email, in Our discretion, except (a) when We launch a new service or feature, or (b) in urgent situations, such as preventing ongoing abuse or responding to legal requirements. If You do not agree to any modification or other update, then Your sole remedy will be to terminate the Agreement (and Your use of the Services as a result). Your continued use of the Services (including, without limitation the Platform) following any change to these Terms is and will be deemed to be acceptance of all changes. The headings contained in the Agreement are for convenience of reference only, are not to be considered a part of the Agreement and will not limit or otherwise affect in any way its meaning or interpretation. The Agreement is for the sole benefit of the parties and their respective permitted successors and permitted assigns and nothing herein, express or implied, is intended to or will confer upon any other person (including Your Clients) any legal or equitable right, benefit or remedy of any nature whatsoever, under or by reason of the Agreement. If any provision of the Agreement is found by any court or administrative body of competent jurisdiction to be invalid or unenforceable, such invalidity or unenforceability will not affect the other provisions of the Agreement, which will remain in full force and effect. The Agreement (including the Order Form) represents the entire understanding and agreement between the parties with respect to the subject matter hereof, and supersede all other negotiations, understandings and representations (if any) made by and between such parties, whether orally or in writing. The Order Form may be executed in counterparts, each of which will be an original, but all of which together will constitute one and the same instrument. Confirmation of execution by electronic transmission signature page or other electronic execution means will be binding, and each party irrevocably waives any objection that it has or may have in the future as to the validity of any such electronic execution.
          </p>

          {/* Section 19 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">19. CONTACTING US</h3>
          <p>
            If you have any questions about these Terms, please contact us at{' '}
            <a href="mailto:info@nineminds.com" className="text-primary-600 hover:underline">info@nineminds.com</a>.
          </p>
        </div>

        <button
          onClick={handleBack}
          className="mt-8 px-4 py-2 bg-gray-600 text-white rounded-md shadow hover:bg-gray-700 transition"
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
