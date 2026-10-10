<?php
// Seeds the demo Space and clearly labeled synthetic posts. Idempotent: re-running skips what exists.
// Run with: ./seed.sh (see community/README.md)

namespace pilot;

use humhub\modules\content\models\Content;
use humhub\modules\post\models\Post;
use humhub\modules\space\models\Space;
use humhub\modules\user\models\User;
use Yii;
use yii\console\Controller;

class SeedController extends Controller
{
    public function actionIndex(string $formUrl)
    {
        Yii::$app->user->switchIdentity(User::findOne(['username' => 'admin']));

        // Let visitors read the Space without an account (posting still needs login).
        Yii::$app->getModule('user')->settings->set('auth.allowGuestAccess', 1);

        $space = Space::findOne(['name' => 'Corona community']);
        if ($space === null) {
            $space = new Space(['scenario' => Space::SCENARIO_CREATE]);
            $space->name = 'Corona community';
            $space->description = 'Local questions and directory corrections for Corona, Queens. Pilot: synthetic posts only.';
            $space->visibility = Space::VISIBILITY_ALL;
            $space->join_policy = Space::JOIN_POLICY_FREE;
            $space->default_content_visibility = Content::VISIBILITY_PUBLIC;
            if (!$space->save()) {
                $this->stderr(print_r($space->getErrors(), true));
                return 1;
            }
        }

        $posts = [
            ['pin' => true, 'message' => <<<MD
**📌 How resource tips work here**

Know a food pantry, clinic, or legal help office that is missing from the NYC Navigator directory, or a listing with wrong hours or a wrong address?

👉 **Suggest it here: [NYC Navigator: suggest a resource]($formUrl)**

What happens next:
1. Your tip goes into the Navigator's **pending review queue**.
2. A person checks it against a source.
3. **Only a reviewed and approved tip can become a directory result.**

Posts in this Space are discussion only. They are **not** added to directory search. Questions (for example housing questions) stay here as conversations with neighbors.

_This is a pilot. Posts marked [SYNTHETIC DEMO] are made-up examples, not real people._
MD],
            ['pin' => false, 'message' => <<<MD
**[SYNTHETIC DEMO POST: not a real person]**

🏠 Housing question: My landlord in Corona says I have to leave by the end of the month but I never got any papers. Does anyone know where in Queens I can get free help with this? I speak Spanish.

_(Discussion only. This question stays in the community and does not go into directory search.)_
MD],
            ['pin' => false, 'message' => <<<MD
**[SYNTHETIC DEMO POST: not a real person]**

✏️ Resource correction: The pantry on Roosevelt Ave seems to have new Saturday hours (9 to 11am now?). I submitted it through the "suggest a resource" form pinned above so someone can check it before the directory changes.
MD],
        ];

        foreach ($posts as $p) {
            $exists = Post::find()->contentContainer($space)->andWhere(['message' => $p['message']])->exists();
            if ($exists) {
                continue;
            }
            $post = new Post($space);
            $post->message = $p['message'];
            $post->content->visibility = Content::VISIBILITY_PUBLIC;
            if (!$post->save()) {
                $this->stderr(print_r($post->getErrors(), true));
                return 1;
            }
            if ($p['pin']) {
                $post->content->pin();
            }
        }

        $this->stdout("Space: " . $space->getUrl(true) . "\n");
        foreach (Post::find()->contentContainer($space)->all() as $post) {
            $this->stdout(($post->content->isPinned() ? '[pinned] ' : '') . $post->getUrl(true) . "\n");
        }
        return 0;
    }
}
