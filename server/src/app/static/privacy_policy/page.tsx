"use client";
import { useRouter } from 'next/navigation';

export default function PrivacyPolicy() {
  const router = useRouter();

  const handleBack = () => {
    router.back();
  };

  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4">
      <div className="bg-white p-8 rounded-lg shadow-lg max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-primary-600 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last Updated: April 3, 2026</p>

        <div className="prose prose-gray max-w-none text-gray-700 space-y-6">
          <p>
            Nine Minds LLC (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) are pleased to provide you with access to our Services. This Privacy Policy describes our practices with respect to the collection, transfer, manipulation, disclosure and other uses of Your Information and certain other information collected by us through our Services. For purposes of this Privacy Policy, &ldquo;Your Information&rdquo; means information about you which may be of a confidential nature and may include personally identifiable information, including your first and last name and email address. Capitalized terms used but not defined in this Privacy Policy have the meanings ascribed to them by our Master Terms (&ldquo;Terms&rdquo;).
          </p>

          <p>
            This Privacy Policy applies to information collected by us through our Services, but does not apply to information collected by any person or entity other than us, even if related to our Services (such as by our Third-Party Service Providers).
          </p>

          <p className="font-bold text-sm bg-gray-50 p-4 rounded border border-gray-200">
            PLEASE READ THIS PRIVACY POLICY CAREFULLY BEFORE USING OUR SERVICES. BY USING OUR SERVICES OR BY CLICKING TO ACCEPT OR AGREE TO OUR TERMS WHEN THIS OPTION IS MADE AVAILABLE TO YOU, YOU ACCEPT AND AGREE TO BE BOUND AND ABIDE BY OUR TERMS, INCLUDING THIS PRIVACY POLICY. IF YOU DO NOT WANT YOUR INFORMATION USED OR DISCLOSED IN THE MANNER DESCRIBED IN THIS PRIVACY POLICY, OR IF YOU DO NOT AGREE WITH ANY TERM OR CONDITION IN OUR TERMS, INCLUDING THIS PRIVACY POLICY, THEN YOU MUST NOT ACCESS OR USE OUR SERVICES (IN WHOLE OR IN PART) OR SUBMIT YOUR INFORMATION TO US.
          </p>

          <p>
            This Privacy Policy may change from time to time. If we make changes, we will notify you by revising the date at the top of this Privacy Policy. Amendments will take effect immediately on our posting of the updated Privacy Policy. Your continued access or use of our Services after receiving the notice of changes means you accept the updated Privacy Policy, so please check this policy periodically for updates.
          </p>

          {/* Section 1 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">1. Individuals Under the Age of 18</h3>
          <p>
            Our Services are available only to individuals who are eighteen (18) years of age or older. If you do not meet this age requirement, you may not use our Services.
          </p>
          <p>
            We do not knowingly collect personally identifiable information by anyone under the age of 16 and you should not provide us with any information regarding any individual under the age of 16. If we learn that we have inadvertently gathered information from anyone under the age of 16, we will take reasonable measures to promptly remove that information from our records.
          </p>

          {/* Section 2 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">2. What Information We Collect and How We Collect It</h3>
          <p>
            We receive and collect several types of information about you, such as the information described below.
          </p>

          <h4 className="text-base font-bold text-gray-800">Information you provide to us</h4>
          <p>
            From time to time, you may provide us with certain information, including Your Information, such as your name, email address and phone number. Instances where you may provide this information include when you set up or register for an account on or through our Services, fill out forms or fields on or through our Services, or sign up for any promotions or to receive newsletters or other materials from or about us.
          </p>

          <h4 className="text-base font-bold text-gray-800">Information we receive from third parties</h4>
          <p>
            We may obtain information about you from sources other than you, such as from our payment processing services provider when you make payments on or through our Services. Any content or information submitted by you to third parties will be used and disclosed by such third parties in accordance with their respective privacy policies. You should review the privacy policies and practices of such third parties prior to disclosing information to them.
          </p>
          <p>
            We may also collect information on third party platforms such as Google AdWords, Google Analytics, etc. Additionally, some information we collect is publicly available. For example, we may collect information you submit to a blog, a chat room, or a social network like Facebook, Instagram, Twitter or Google+.
          </p>

          <h4 className="text-base font-bold text-gray-800">Information we collect automatically</h4>
          <p>
            As you navigate through and interact with our Services, we and third parties acting on our behalf may use automatic data collection technologies to collect certain information. See Section 3 &ldquo;Cookies and Other Automatic Tracking Technologies&rdquo; for more information.
          </p>

          <h4 className="text-base font-bold text-gray-800">Our Collection Practices with Respect to Certain Specific Information</h4>

          <p>
            <strong>Device Information</strong><br />
            When you access or use our Services through your computer, mobile phone or other device, we may collect information regarding and related to your device, such as hardware models and IDs, device type, operating system version, the request type, the content of your request and basic usage information about your use of our Services, such as date and time. In addition, we may collect information regarding application-level events, such as caches, and associate that temporarily with your account (if any) to provide customer service. We may also collect and store information locally on your device using mechanisms such as browser web storage and application data caches.
          </p>

          <p>
            <strong>Mobile Application</strong><br />
            When you use our mobile application, we collect the following additional information:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-2">
            <li><strong>Device Identifiers:</strong> We collect a stable device identifier to associate your device with your account. On iOS, this is the Identifier for Vendor (IDFV), which is unique to our app on your device. On Android, this is the Android ID. This identifier is stored securely on your device and sent with API requests to authenticate your device.</li>
            <li><strong>Push Notification Tokens:</strong> If you enable push notifications, we collect a push notification token from your device along with your device identifier, platform type (iOS or Android), and app version. This information is sent to our servers solely to deliver push notifications to your device. You can disable push notifications at any time through your device settings.</li>
            <li><strong>Device Metadata:</strong> With each API request, we send your device platform, app version, and app build number. This information is used for compatibility, debugging, and to ensure you receive the correct version of our Services.</li>
            <li><strong>Biometric Authentication:</strong> Our mobile application may offer biometric authentication (such as Face ID or fingerprint recognition) as a convenience feature. No biometric data is collected, stored, or transmitted by us. Biometric authentication is handled entirely by your device&apos;s operating system. We only store your preference for whether biometric unlock is enabled, and this preference is stored locally on your device.</li>
            <li><strong>Secure Credential Storage:</strong> Authentication tokens and session credentials are stored on your device using platform-provided secure storage (iOS Keychain or Android Keystore). These credentials remain on your device and are not accessible to other applications.</li>
            <li><strong>Crash Reports and Diagnostics:</strong> In production builds, our mobile application sends crash reports and error diagnostics to our third-party error monitoring service (Sentry). These reports include error details and stack traces, your user ID and email address (if you are logged in), your tenant identifier, and your app version and build number. We do not include the contents of your API requests or responses, passwords, or other sensitive data in crash reports. See Section 3 for more information.</li>
            <li><strong>Photos and Files:</strong> If you choose to attach photos or files to a ticket, we access your device&apos;s camera or file storage only when you explicitly initiate the action. Photos and files you select are uploaded to our servers as ticket attachments. We do not access your camera, photo library, or file storage at any other time.</li>
          </ul>
          <p>
            Our mobile application does not collect your location, access your contacts or calendar, or record audio.
          </p>

          <p>
            <strong>Location Information</strong><br />
            If you submit your zip code or other geographic information to us, you may provide us with your location information. Furthermore, if you enable the collection of location information on your device, then we may collect information about your actual location, such as your mobile device&apos;s GPS coordinates. We may also use other technologies to determine your location (such as through the location of nearby Wi-Fi access points or cell towers) or obtain your location information from third parties.
          </p>

          <p>
            <strong>Communications with Us</strong><br />
            We may collect information about your communications with us, including relating to support questions, your purchases, and other inquiries.
          </p>

          <p>
            <strong>Third-party content, features or application providers may collect information</strong><br />
            Some content, features or applications on our Services may be served by third parties, including our Third-Party Service Providers, ad networks and servers, content providers and other application providers. These third parties may collect information about you when you use our Services using cookies alone or in conjunction with web beacons or other tracking technologies. We do not control these third parties&apos; tracking technologies or how they may be used. If you have any questions about an advertisement or other targeted content, you should contact the responsible provider directly. Please note that the information collected by these third parties may be associated with Your Information and that these third parties may collect information, including Your Information, about your online activities over time and across different websites and other online services.
          </p>

          {/* Section 3 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">3. Cookies and Other Automatic Tracking Technologies</h3>

          <h4 className="text-base font-bold text-gray-800">Description of the Technologies Utilized on our Services</h4>
          <p>
            We may use various technologies to collect and store information when you access or use our Services, including sending cookies, embedded scripts, web beacons, pixel tags or other anonymous identifiers to your device, or otherwise tracking your activities on our Services over time. We also may use these technologies to collect information about your online activities over time and across third-party websites or other online services (a practice known as &ldquo;behavioral tracking&rdquo;).
          </p>
          <p>
            &ldquo;Cookies&rdquo; are small web files that a site or its provider transfers to your device&apos;s hard drive through your web browser that enables the site&apos;s or provider&apos;s system to recognize your browser and remember certain information. The length of time a cookie will stay on your browsing device depends on whether it is a &ldquo;persistent&rdquo; or &ldquo;session&rdquo; cookie. Session cookies will only stay on your device until you stop browsing. Persistent cookies stay on your browsing device until they expire or are deleted.
          </p>
          <p>
            A &ldquo;web beacon&rdquo; is a type of technology that lets us know if you visited a certain page or whether you opened an email.
          </p>
          <p>
            A &ldquo;pixel tag&rdquo; is a type of technology placed within a website or e-mail for the purpose of tracking activity, which is often used in combination with cookies.
          </p>
          <p>
            &ldquo;Anonymous identifiers&rdquo; include random strings of characters used for the same purposes as cookies, such as with mobile devices where cookie technology may not be available.
          </p>
          <p>
            These technologies help us know that you are logged on to or using our Services, provide you with features based on your preferences, help us understand when and how you are interacting with our Services and compile other information regarding your use of our Services.
          </p>

          <h4 className="text-base font-bold text-gray-800">Cookie Categories</h4>
          <p>With respect to Cookies, we use first-party and third-party cookies to:</p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Make our Services function properly</li>
            <li>Improve our Services</li>
            <li>Make access to our Services easier</li>
            <li>Recognize you when you return to our Services</li>
            <li>Track your interaction with our Services</li>
            <li>Enhance your experience with our Services</li>
            <li>Remember information you have already provided</li>
            <li>Collect information about your activities over time and across third-party websites or other online services in order to deliver content and advertising tailored to your interests</li>
            <li>Provide a secure browsing experience during your use of our Services</li>
          </ul>

          <p>The categories of cookies used or that may be used on our Services include:</p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Strictly Necessary Cookies</strong>, which are needed for the Services to operate as you reasonably expect.</li>
            <li><strong>Functional or Preference Cookies</strong>, which are used to remember your name or choices.</li>
            <li><strong>Performance or Analytic Cookies</strong>, which collect passive information about your use of the Services.</li>
            <li><strong>Advertising or Targeting Cookies</strong>, which are used to make advertising messages more relevant and personalized to you based on your inferred interests.</li>
          </ul>

          <h4 className="text-base font-bold text-gray-800">Third-Party Analytics</h4>
          <p>
            We may use third-party service providers to monitor and analyze the use of our Services. For example, we may use Google Analytics as one of our analytics service providers that tracks and reports website traffic. For more information on the privacy practices of Google, please visit the Google Privacy &amp; Terms web page. To opt out of Google Analytics entirely please use the Google Analytics opt-out browser add-on.
          </p>
          <p>
            Our mobile application uses Sentry for crash reporting and error monitoring. When an error occurs in the mobile application, Sentry receives diagnostic information including the error message, stack trace, your user ID, email address, and app version. We configure Sentry to not collect personally identifiable information by default and to exclude the contents of API requests and responses.
          </p>
          <p>
            The information collected through these technologies, standing alone, cannot be used to determine your identity. Such information may, however, be combined in a way that makes it become personally identifiable information (i.e., information that can identify you). For example, we may tie this information to personal information about you that we collect from other sources or that you provide to us. If this happens, we will treat the combined information as personally identifiable information.
          </p>

          <h4 className="text-base font-bold text-gray-800">Choices as to Cookies and Other Automatic Tracking Technologies</h4>
          <p>
            It may be possible to disable some (but not all) Cookies or automatic data collection technologies through your device or browser settings, but doing so may affect the functionality of all or a portion of our Services. The method for disabling Cookies or other automatic collection technologies may vary by device and browser but can usually be found in preferences or security settings. For example, iOS and Android devices each have settings which are designed to limit forms of ad tracking. See Section 6 &ldquo;Choices About How We Use and Disclose Your Information&rdquo; for more information.
          </p>

          <h4 className="text-base font-bold text-gray-800">Do Not Track Requests</h4>
          <p>
            Some Internet browsers, such as Internet Explorer, Firefox, and Safari, include the ability to transmit &ldquo;Do Not Track&rdquo; or &ldquo;DNT&rdquo; signals. Since uniform standards for &ldquo;DNT&rdquo; signals have not been adopted, our Services do not currently process or respond to &ldquo;DNT&rdquo; signals.
          </p>

          {/* Section 4 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">4. How We Use Your Information</h3>
          <p>
            We may use the information we collect for various lawful business purposes. Among others, these purposes may include using this information, including Your Information, to:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-2">
            <li><strong>Present and provide our Services and related content to you.</strong> For example, to provide our Services, including its features, products and services to you and/or other users. We may also use Your Information to manage our relationship and contracts with customers and clients, including billing, compliance with contractual obligations, and related administration.</li>
            <li><strong>Contact you and provide you with information.</strong> For example, if you complete the &ldquo;contact us&rdquo; form on our Services, we might contact you via e-mail or other communications to provide you with information regarding our Services, products, promotions, offers, personalized information and other information from us or our Third-Party Service Providers or business partners or to respond to comments, questions, inquiries, and other information submitted by you. We may also use Your Information to send you promotional materials, offers, and/or messages related to our Services.</li>
            <li><strong>Provide you with customer support.</strong> For example, if you request us to contact you in connection with any customer support matters, we may collect certain information from you in order to assist you as requested.</li>
            <li><strong>Analyze, improve, and manage our Services, products, service offerings and operations.</strong> For example, we might obtain feedback regarding our Services, products, and service offerings, to: (i) understand and anticipate your needs and preferences, (ii) better understand your use of our Services or products or service offerings, (iii) customize and tailor website content and advertising, (iv) improve our marketing and promotional efforts, (v) engage in statistical analysis, and (vi) provide feedback or information to our business partners, vendors, advertisers and other third parties.</li>
            <li><strong>Resolve problems and disputes and engage in other legal and security matters.</strong> For example, we may use the information we collect to comply with, monitor compliance with and enforce this Privacy Policy, our Terms and any other applicable agreements and policies, meet other legal and regulatory requirements, and protect the security and integrity of our Services.</li>
            <li><strong>To fulfill any other purpose for which you provide it.</strong> For example, if you share your name and contact information to request a price quote or ask a question about our products or services, we will use that personal information to respond to your inquiry. If you provide your personal information to purchase a product or service, we will use that information to process your payment and facilitate delivery.</li>
            <li><strong>Display advertisements to our advertisers&apos; target audiences.</strong> For example, we may use your device information for direct advertising and retargeting ads, such as providing you with information or advertising relating to our products and services based on your location, when in line with the preferences you have shared with us.</li>
            <li><strong>Maintain app stability and diagnose issues.</strong> For example, we use crash reports and error diagnostics collected from our mobile application to identify, diagnose, and fix software bugs and performance issues, ensuring the reliability and quality of our Services.</li>
            <li><strong>Deliver push notifications.</strong> For example, we use push notification tokens to send you timely updates about tickets, tasks, and other activity relevant to your account. You can disable push notifications at any time through your device settings.</li>
            <li><strong>Comply with a request from you in connection with the exercise of your rights.</strong> For example, where you have asked us not to contact you for marketing purposes, we or our service providers will keep a record of this on our suppression lists to be able to comply with your request.</li>
            <li><strong>Other Purposes.</strong> We may also use Your Information in other ways. To the extent required by applicable law, we will provide notice at the time of collection and obtain your consent.</li>
          </ul>

          {/* Section 5 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">5. How We Disclose Your Information</h3>

          <h4 className="text-base font-bold text-gray-800">General Disclosure of Your Information</h4>
          <p>We may disclose or share the information we collect, including Your Information:</p>
          <ul className="list-disc list-inside ml-4 space-y-2">
            <li>To our Third-Party Service Providers, vendors or suppliers (including our payment processing third-party provider and our hosting provider) so that they may provide support for our internal and business operations, including for the processing of your payment for a product or service, data verification, data storage, surveys, research, internal marketing, delivery of promotional, marketing and transaction materials and our Services&apos; maintenance and security.</li>
            <li>To our affiliates and their respective employees, agents and representatives involved in delivering our Services, products and other services to you;</li>
            <li>To fulfill the purpose for which you provide it;</li>
            <li>To any person who, in our reasonable judgment, is authorized to receive Your Information as your agent, including as a result of your business dealings with that person (for example, your attorney);</li>
            <li>As required by applicable law or ordered by a court, regulatory or administrative agency;</li>
            <li>As we deem necessary, in our sole discretion, if we believe that you are violating any applicable law, rule, restriction or regulation, or are otherwise interfering with another&apos;s rights or property, including our rights or property;</li>
            <li>If requested by authorities in the event of any act or instance of local, regional or national emergency;</li>
            <li>To enforce our Terms, including this Privacy Policy, and any other applicable agreements and policies;</li>
            <li>With your consent;</li>
            <li>To otherwise enforce or protect our rights; and</li>
            <li>In connection with a Business Transfer (see &ldquo;Other Disclosures by Us&rdquo; below).</li>
          </ul>
          <p>
            Please note that the list above is not exhaustive and that we may, to the extent permitted by applicable law, disclose the information we collect to third parties at any time, for any lawful purpose, without notice or compensation to you.
          </p>
          <p>
            When we disclose the information we collect to third parties, such information will become permanently subject to the information use and sharing practices of the third party, and the third party will not be restricted by this Privacy Policy with respect to its use and further sharing of such information. Furthermore, these third parties may further disclose, share and use this information. By submitting information (including Your Information) to us, you expressly consent to such disclosure and use of such information. If you do not want this information (including Your Information) shared as described above, then you should not provide us with such information.
          </p>

          <h4 className="text-base font-bold text-gray-800">Other Disclosures by Us</h4>

          <p>
            <strong>Aggregation and De-Personalization</strong><br />
            We may use and disclose any de-identified information for any lawful purpose, including for any commercial purpose. De-identified Information means information that does not identify you, including any identifiable information de-identified by either combining it with information about others, for example, by aggregating Your Information with information about other persons, or by removing characteristics, such as your name, that make the information personally identifiable to you.
          </p>

          <p>
            <strong>Business Transfers</strong><br />
            We may disclose, lease, sell, assign, or transfer the information we collect (including Your Information) to third parties in connection with a Business Transfer. A &ldquo;Business Transfer&rdquo; means a sale, acquisition, merger, consolidation, reorganization, bankruptcy, or other corporate change involving us, even if the Business Transfer is only being contemplated and regardless of whether the Business Transfer relates to a part of or our whole business. Nothing in this Privacy Policy is intended to interfere with our ability to transfer all or part of our business, equity, or assets (including our Services) to an affiliate or independent third party at any time, for any lawful purpose, without notice or compensation to you.
          </p>

          <p>
            <strong>Circumvention of Security Measures</strong><br />
            We use certain technical, administrative, and organizational security measures to keep Your Information safe. However, despite our efforts, please be aware that methods of transmission and electronic storage are not completely secure. We cannot guarantee the privacy or security of Your Information, as third parties may unlawfully intercept or access transmissions or electronic storage. Further, to the extent permitted by law, we are not responsible for circumvention of any privacy settings or security measures of our Services. Therefore, you use our Services at your own risk, you should not expect that Your Information will always remain private, and we do not guarantee the performance or adequacy of our security measures. In the event that an unauthorized third party compromises our security measures, to the extent permitted by law, we will not be responsible for any damages, directly or indirectly, caused by an unauthorized third party&apos;s ability to view, use or disseminate Your Information.
          </p>

          {/* Section 6 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">6. Choices About How We Use and Disclose Your Information</h3>
          <p>
            We strive to provide you with choices regarding our collection, use and disclosure of the information that we collect. Below are some mechanisms that provide you with control over such collection, use or disclosure:
          </p>

          <h4 className="text-base font-bold text-gray-800">Cookies and Other Tracking Technologies</h4>
          <p>
            It may be possible to disable some (but not all) cookies or automatic data collection technologies through your device or browser settings, but doing so may affect the functionality of our Services. The method for disabling cookies or other automatic collection technologies may vary by device and browser, but can usually be found in preferences or security settings.
          </p>
          <p>
            You can exercise your preferences in relation to cookies served on our Services by taking the steps outlined below.
          </p>
          <p>
            <strong>First-Party Cookies:</strong> You can use the browser with which you are viewing our Services to enable, disable or delete cookies. To do this, follow the instructions provided by your browser (usually located within the &ldquo;Help&rdquo;, &ldquo;Tools&rdquo; or &ldquo;Edit&rdquo; settings). Please note, if you set your browser to disable cookies, you may not be able to access secure areas of our Services. Also, if you disable certain cookies, other parts of our Services may not work properly.
          </p>
          <p>
            <strong>Third-Party Cookies:</strong> To opt-out of third-party advertising networks and similar entities that use advertising cookies go to aboutads.info/choices.
          </p>
          <p>
            We do not control third-parties&apos; collection or use of Your Information to serve interest-based advertising. However, these third-parties may provide you with ways to choose not to have Your Information collected or used in this way.
          </p>

          <h4 className="text-base font-bold text-gray-800">E-mail Offers</h4>
          <p>
            If you do not wish to receive e-mail offers or other information or communications from us, you can opt-out of receiving such e-mail offers or other information or communications from us (other than e-mails or other information or communications related to correction of user data, change of password and other similar communications essential to your transactions, account or purchases on or through our Services) by using the unsubscribe process at the bottom of the e-mail. Please be aware that it can take up to 10 business days to remove you from our marketing e-mail lists. If you opt-out from receiving our marketing e-mails, you may continue to receive certain status e-mails relating to your transactions and purchases on or through our Services.
          </p>

          <h4 className="text-base font-bold text-gray-800">Managing Your Information</h4>
          <p>
            If you create an account with us, then you can review and update Your Information by logging into that portion of our Services, visiting your account profile page and making changes.
          </p>

          <h4 className="text-base font-bold text-gray-800">Online Behavioral Advertising; Targeted Advertising</h4>
          <p>
            As described above, we may use Your Information to provide you with targeted advertisements or marketing communications we believe may be of interest to you. Certain third-party advertising networks that deliver behavioral advertising are members of the Network Advertising Initiative (&ldquo;NAI&rdquo;). You can prevent NAI member companies from collecting preference data about you by visiting the NAI&apos;s opt-out page and following the NAI&apos;s directions. Note that if you opt-out through the NAI, you will still receive advertising. In addition, if you opt-out through the NAI and later delete your Cookies, use a different browser or buy a new computer, you will need to renew your opt-out choice.
          </p>

          <h4 className="text-base font-bold text-gray-800">Accessing and Correcting Your Information</h4>
          <p>
            You can review and change your personal information by logging into the Services and visiting your account profile page or you may send us an email at{' '}
            <a href="mailto:info@nineminds.com" className="text-primary-600 hover:underline">info@nineminds.com</a>{' '}
            to request access to, correct or delete any personal information that you have provided to us. We may not accommodate a request to change information if we believe the change would violate any law or legal requirement or cause the information to be incorrect. Typically, we retain your personal information for the period necessary to fulfill the purposes outlined in this Privacy Policy, unless a longer retention period is required or permitted by law. Please note that in many situations we must retain all, or a portion, of your personal information to comply with our legal obligations; resolve disputes; enforce our agreements; protect against fraudulent, deceptive, or illegal activity; or for another one of our business purposes.
          </p>

          {/* Section 7 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">7. Information that You Disclose to Third Parties</h3>
          <p>
            Our Services, including any of our newsletters or e-mail messages, may contain links or access to websites or platforms operated by third parties that are beyond our control. Links or access to third parties from our Services is not an endorsement by us of such third parties, or their respective websites, applications, products, platforms, or practices. We are not responsible for the privacy policies, terms and conditions, practices, or the content of such third parties. All information that you disclose to such third parties will be subject to the privacy policies and practices of such third parties. You should review the privacy policies and practices of such third parties prior to disclosing information to them. If you have any questions about how these third parties use Your Information, you should review their policies and contact them directly.
          </p>

          {/* Section 8 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">8. Operation of our Services in the United States</h3>
          <p>
            Our Services are operated in the United States of America (&ldquo;U.S.&rdquo;). As a result, the information we collect (including Your Information) will be used and disclosed as described in this Privacy Policy in the U.S., as well as in other countries if you access our Services outside of the U.S. In some cases, the laws of countries other than the U.S. regarding our use and disclosure of Your Information may be less stringent than the laws of the U.S.
          </p>

          {/* Section 9 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">9. Google API Services User Data Policy</h3>

          <h4 className="text-base font-bold text-gray-800">Overview</h4>
          <p>
            Our Services may use Google API Services to access certain information from your Google account with your explicit permission. This section describes how we handle data obtained through Google APIs, which is subject to additional restrictions beyond those described elsewhere in this Privacy Policy.
          </p>

          <h4 className="text-base font-bold text-gray-800">Our Use of Google User Data</h4>
          <p>
            Nine Minds LLC&apos;s use of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements.
          </p>

          <h4 className="text-base font-bold text-gray-800">What Google Data We Access</h4>
          <p>When you choose to connect your Google account to our Services, we may request access to:</p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Gmail (if applicable):</strong> To read email messages and metadata for creating service tickets in response to inbound emails</li>
          </ul>
          <p>
            You will be shown exactly which permissions we are requesting before you grant access, and you can choose to deny any or all of these permissions.
          </p>

          <h4 className="text-base font-bold text-gray-800">How We Use Google User Data</h4>
          <p>
            We use data obtained from Google APIs solely to provide and improve the specific features of our Services that you have chosen to use. Specifically:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Gmail data is used only to provide inbound ticketing for the Alga PSA service desk</li>
          </ul>

          <h4 className="text-base font-bold text-gray-800">Limited Use Requirements</h4>
          <p>
            Notwithstanding anything else in this Privacy Policy, our use of data obtained through Google APIs is subject to these additional restrictions:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-2">
            <li><strong>No Sale of Data:</strong> We will never sell Google user data to third parties.</li>
            <li><strong>No Use for Advertising:</strong> We will not use Google user data to serve advertisements or for ad targeting purposes.</li>
            <li><strong>Limited Purpose:</strong> We will only use Google user data for the specific purposes described in this section and as necessary to provide or improve user-facing features that are prominent in our Services&apos; user interface.</li>
            <li><strong>No Transfer Except as Necessary:</strong> We will not transfer Google user data to third parties except: as necessary to provide or improve user-facing features that are prominent in our Services; to comply with applicable law; as part of a merger, acquisition, or sale of assets, with prior notice to users; or with your explicit consent.</li>
            <li><strong>Human Review Limitations:</strong> We will not allow humans to read Google user data unless: we have your explicit consent; it is necessary for security purposes (such as investigating abuse); it is required to comply with applicable law; or the data has been aggregated and anonymized.</li>
          </ul>

          <h4 className="text-base font-bold text-gray-800">Data Retention for Google User Data</h4>
          <p>We retain Google user data only for as long as necessary to provide the services you have requested. Specifically:</p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Active use data:</strong> Retained while your account is active and you maintain the Google connection</li>
            <li><strong>Deleted data:</strong> When you disconnect your Google account or delete your account with us, we will delete your Google user data within 30 days, except where retention is required by law</li>
          </ul>

          <h4 className="text-base font-bold text-gray-800">Security of Google User Data</h4>
          <p>
            In addition to the security measures described elsewhere in this Privacy Policy, we implement additional safeguards for Google user data:
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>All Google user data is encrypted in transit using TLS/SSL</li>
            <li>Access to Google user data is restricted to authorized personnel only on a need-to-know basis</li>
            <li>We regularly audit access logs and security practices</li>
            <li>We comply with Google&apos;s security requirements for OAuth applications</li>
          </ul>

          <h4 className="text-base font-bold text-gray-800">Your Control Over Google User Data</h4>
          <p>You maintain control over your Google user data at all times:</p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li><strong>Revoke Access:</strong> You can revoke our access to your Google account at any time through your Google Account permissions page</li>
            <li><strong>Delete Data:</strong> You can request deletion of your Google user data by contacting us at <a href="mailto:info@nineminds.com" className="text-primary-600 hover:underline">info@nineminds.com</a> or through your account settings</li>
            <li><strong>Review Permissions:</strong> You can review which Google permissions our Services are using at any time</li>
          </ul>
          <p>
            When you revoke access, we will stop accessing new data from your Google account immediately and will delete existing Google user data in accordance with our retention policy stated above.
          </p>

          <h4 className="text-base font-bold text-gray-800">Changes to Google Data Usage</h4>
          <p>If we change how we use Google user data in any material way, we will:</p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>Update this Privacy Policy with the new use case</li>
            <li>Notify you via email or prominent notice in our Services</li>
            <li>Request your consent for the new use if required by applicable law or Google&apos;s policies</li>
            <li>Provide you an opportunity to revoke access before the new use takes effect</li>
          </ul>

          <h4 className="text-base font-bold text-gray-800">Contact for Google User Data Questions</h4>
          <p>
            If you have specific questions about how we use your Google user data, please contact us at{' '}
            <a href="mailto:info@nineminds.com" className="text-primary-600 hover:underline">info@nineminds.com</a>{' '}
            with &ldquo;Google User Data&rdquo; in the subject line.
          </p>

          <h4 className="text-base font-bold text-gray-800">Compliance</h4>
          <p>
            This section is designed to comply with Google&apos;s API Services User Data Policy and OAuth 2.0 Policies. In the event of any conflict between this section and other parts of this Privacy Policy, this section will govern with respect to data obtained through Google APIs.
          </p>

          {/* Section 10 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">10. Your State Privacy Rights</h3>
          <p>
            State consumer privacy laws may provide their residents with additional rights regarding our use of their personal information. We will comply with all such laws that apply to us and with respect to our collection, use and/or disclosure of Your Information.
          </p>

          {/* Section 11 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">11. Changes to Our Privacy Policy</h3>
          <p>
            We may amend this Privacy Policy at any time and from time to time. Amendments will take effect immediately upon us posting the updated Privacy Policy on our Services. Accordingly, you are encouraged to revisit this Privacy Policy from time to time in order to review any changes that we have made. The date on which this Privacy Policy was last updated will be noted immediately above this Privacy Policy.
          </p>

          {/* Section 12 */}
          <h3 className="text-lg font-bold text-gray-800 mt-8">12. Contacting Us</h3>
          <p>
            If you have any questions, suggestions or complaints regarding our use or disclosure of the information we collect from you or wish to contact us to make a request regarding such information (including Your Information), please contact us at{' '}
            <a href="mailto:info@nineminds.com" className="text-primary-600 hover:underline">info@nineminds.com</a>.
          </p>
          <p>
            In contacting us, you must include the reference to &ldquo;Privacy Request&rdquo; in the subject line and in the body of the message and include the email address or mailing address, as applicable, for us to send our response. We reserve the right not to respond to inquiries submitted other than to the address specified above.
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
