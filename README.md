# Wayfinder Flight Booking System Use Case

This tutorial is based on the Wayfinder Flight Booking System use case. The scenario demonstrates how to deliver a secure and seamless digital travel experience with:

- Smooth consumer onboarding and authentication
- Customer Data Service (CDS) integration to power personalized experiences through unified user profiles and behavior insights
- Verifiable Credentials (VC) based trust and verification
- AI agent security controls across user journeys and API access

The B2C sample app from the 2026 sample apps repository will be moved into this repository, and this guide defines the target configuration flow in Asgardeo.

## Prerequisites

- An Asgardeo account with permissions to create and manage applications, flows, and connections
- Node.js 18 or newer and npm
- Git and a code editor
- Lissi wallet installed mobile phone for VC testing (https://apps.apple.com/us/app/lissi-id-wallet/id6475958390)

## Project Structure
TODO

## Asgardeo Configuration Steps

### 1. Register Single Page Application

- Sign in to Asgardeo Console
- Navigate to Applications and create a new Single Page Application
- Set the application name for the `Wayfinder`
- Add the `http://localhost:5173` as the authorized redirect URL
- Click on the Create button

Documentation: https://wso2.com/asgardeo/docs/guides/applications/register-single-page-app/

### 2. Edit Application

- Open the created application
- Navigate to the General tab
- Add `http://localhost:5173` as the Access URL
- Click on the Update button

- Navigate to the Protocol tab
- Note the client id
- Make sure `Code` and `Refresh Token` are maked as Allowed grant types
- Cross check `http://localhost:5173` is saved in Authorized redirect URLs and Allowed origins
- Cross check PKCE mandatory config is enabled
- Click on the Update button

- Navigate to the User Attribute tab
- Select `username` as a requested attribute
- Click on the Update button

- Navigate to the Login Flow tab
- Change the login options as required

Documentation: https://wso2.com/asgardeo/docs/guides/applications/register-oidc-web-app/

### 3. Signup Flow Changing

- Navigate to `Flows` and click on Self Registration card
- Update the sign-up journey to match Wayfinder onboarding requirements
- Enable the flow

Documentation: https://wso2.com/asgardeo/docs/guides/flows/self-registration/

### 4. Configure UI Branding

Documentation: https://wso2.com/asgardeo/docs/guides/branding/configure-ui-branding/

### 5. Configure API Resources

Documentation: https://wso2.com/asgardeo/docs/guides/authorization/api-authorization/api-authorization/

### 6. Configure M2M Application for CDS and VC related API update

- Navigate to Applications > New Application
- Select M2M application template
- Provide the name as `M2M App`
- Navigate to the Authorize tab of the created application
- Configure the following APIs with relevant scopes

| API | Scopes |
|-----|--------|
| Customer Data Service profile management API | Profile create, Profile view, Profile delete, Profile update |
| Customer Data Service config management API | Customer data service configuration view, Customer data service configuration update |
| Application Management API | Create Application |

- Navigate to the Protocol tab
- Under Access Token configuration, change Token type to `JWT`
- Add `iam-cds` as an Audience
- Note the client id and client secret of the application
- Click on the Update button

Documentation: https://wso2.com/asgardeo/docs/guides/applications/register-machine-to-machine-app/

### 7. Configurations for CDS

Business use case for CDS: Users often search for flights and mark favorites before signing in. This data is business-context data (application-level preferences), not core identity data. When the same user signs in later from the same browser, restoring those favorites creates a much smoother booking experience because they can continue from saved preferences instead of searching again.

At sign-in time, the anonymous profile can be merged into the user's permanent profile to improve personalization. Instead of implementing complex custom merge logic in the application, Asgardeo Customer Data Service (CDS) can manage this flow. This pattern can also be extended to many similar use cases.

#### Enable CDS feature

- Click on the profile icon on right top coner on Asgardeo console
- Click on Feature Previews
- Enable Customer Data Service
- Once it is enabled, you can see `Customer Data` menu item on your left menu bar

#### Define Profile Attributes

- Navigate to Customer Data > Profile Attributes
- Click on +Add Profile Attribute
- Under General Details:
    - Select Application Data
    - Select the client Id related to wayfinder application
    - Give `fav_flights` as the attribute name
    - Give `Favorite Flights` as the display name
- Udeer Type & Configuration:
    - Value Type: Text
    - Mutability: Read & Write
    - Allow Multiple Values for this attribute: true
    - Merge Strategy: combine
- click on Finish button

#### Register Your M2M Application as a SYSTEM application for CDS Configs

The M2M application created in step 6 is used by the backend of the end-user application to create temporary profiles, update them, and read application-level data. Customer data related to a specific application can be accessed either with that application token or with a SYSTEM application. Since the end-user app is a single-page application, a separate M2M app is used for profile data management, and it must be registered as a SYSTEM application.

Invoke the following cURL command to register the created M2M application as a SYSTEM application which can view all application related data from profiles.

1. Obtain an access token using the client credential grant type from the M2M application.

```
curl --location 'https://api.asgardeo.io/t/<your-organization-name>/oauth2/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--header 'Authorization: Basic <base 64 encoded application clientId:clientSecret>' \
--data-urlencode 'grant_type=client_credentials' \
--data-urlencode 'scope=internal_cds_admin_config_update internal_cds_admin_config_view'
```

2. Update the customer data service configuration by adding the created M2M application as a SYSTEM application.

```
curl --location --request PATCH 'https://api.asgardeo.io/t/<your-organization-name>/cds/api/v1/config' \
--header 'Authorization: Bearer <Obtained access token from the above step>' \
--data '{
        "cds_enabled": true,
        "system_applications" :[
            "CONSOLE", "<M2M application's client ID>"
        ]
}'
```

### 8. Configurations for VC

#### Configure Custom VC Attributes

- Navigate to User Attributes & Stores > Attributes
- Select Verifiable Credentials tile
- Click New attribute button 
- Create a new attribute as:
    - Verifiable Credentials Attribute: member_since
    - User Attribute to map to: http://wso2.org/claims/created

Documentation: https://wso2.com/asgardeo/docs/guides/verifiable-credentials/issue-vc/#configure-vc-attribute-mappings 

#### Configure VC Template

- Navigate to Verifiable Credentials
- Click on New Credential Template
- Fill the values as follows:
    - Identifer: Wayfinder_member_Id
    - Display Name: Wayfinder Member ID
    - User Attributes: User ID, First Name, Last Name, Email, Created Time
- Once the template is created set the following:
    - Credential Format: dc+sd-jwt
    - Validity Period: 1825 Days (5 years)
- Note the offer URL
- Click on Update button

Documentation: https://wso2.com/asgardeo/docs/guides/verifiable-credentials/issue-vc/#step-1-create-a-credential-template

#### Configure a Digital Wallet

- Obatain an access token using the M2M application created in 6 using the following cURL command

```
curl --location 'https://api.asgardeo.io/t/<your-organization-name>/oauth2/token' \
--header 'Content-Type: application/x-www-form-urlencoded' \
--header 'Authorization: Basic <base 64 encoded application clientId:clientSecret>' \
--data-urlencode 'grant_type=client_credentials' \
--data-urlencode 'scope=internal_application_mgt_create'
```

- Out of the tested walltets, Lissi wallet will be used for this tutorial. Therefore regiter the Lissi Wallet using the following cURL

```
curl --location 'https://api.asgardeo.io/t/<your-organization-name>/api/server/v1/applications/' \
--header 'Accept: application/json' \
--header 'Authorization: Bearer <token obatined from M2M application>' \
--header 'Content-Type: application/json' \
--data '{
    "inboundProtocolConfiguration": {
        "oidc": {
            "clientId" : "9c481dc3-2ad0-4fe0-881d-c32ad02fe0fc",
            "grantTypes": [
                "authorization_code",
                "refresh_token"
            ],
            "publicClient": true,
            "allowedOrigins": [],
            "callbackURLs": [
                "https://oob.lissi.io/vci-cb"
            ],
            "pkce": {
                "mandatory": true,
                "supportPlainTransformAlgorithm": false
            },
            "refreshToken": {
                "renewRefreshToken": true,
                "expiryInSeconds": 86400
            }
        }
    },
    "accessUrl": "",
    "imageUrl": "",
    "name": "Lissi Walltet”,
    "advancedConfigurations": {
        "skipLogoutConsent": true,
        "discoverableByEndUsers": false,
        "skipLoginConsent": true
    },
    "authenticationSequence": {
        "type": "DEFAULT",
        "steps": [
            {
                "options": [
                    {
                        "idp": "LOCAL",
                        "authenticator": "basic"
                    }
                ],
                "id": 1
            }
        ]
    },
    "templateId": "digital-wallet-application",
    "templateVersion": "1.0.1"
}'
```

Documentation: https://wso2.com/asgardeo/docs/guides/verifiable-credentials/issue-vc/#step-2-register-a-digital-wallet-application

#### Allow the Wallet to request the Verifiable Credential

- Navigate to Applications
- Selected the created Lissi Wallet application
- Navigate to Authorize tab
- Click on Authorize verifiable credential button
- Select:
    - Verifiable Credential: Wayfinder Member ID
    - Authorization Policy: No Authrization Policy
- Click on Finish button

Documentation: https://wso2.com/asgardeo/docs/guides/verifiable-credentials/issue-vc/#step-3-allow-the-wallet-to-request-the-credential

### 9. Configurations for AI Agents
